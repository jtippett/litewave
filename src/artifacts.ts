import path from "node:path";
import { readdir, stat } from "node:fs/promises";
import { z } from "zod";
import { AccessError } from "./protocol.js";
import { atomicJson, exists, privateDir, readJson } from "./storage.js";

export const artifactSchema = z.object({
  id: z.uuid(),
  tabId: z.string(),
  actionId: z.string().nullable(),
  status: z.enum(["saving", "complete", "failed"]),
  suggestedFilename: z.string().max(200),
  path: z.string().nullable(),
  size: z.number().int().nonnegative().nullable(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  error: z.string().nullable(),
  failureReason: z.string().max(500).nullable().default(null),
  createdAt: z.string(),
});
export type Artifact = z.infer<typeof artifactSchema>;

// Manifests belong to the registration, not the lifetime of a worker.
export async function loadArtifacts(directory: string): Promise<Artifact[]> {
  if (!(await exists(directory))) return [];
  await privateDir(directory);
  const artifacts = new Map<string, Artifact>();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const legacyFailure = /^[a-f0-9-]{36}\.failed\.json$/.test(entry.name);
    if (!legacyFailure && !/^[a-f0-9-]{36}$/.test(entry.name)) continue;
    const folder = path.join(directory, entry.name);
    if (!legacyFailure) await privateDir(folder);
    const manifest = legacyFailure
      ? folder
      : path.join(folder, "manifest.json");
    if (!(await exists(manifest))) continue; // Legacy incomplete saves had no manifest.
    const parsed = artifactSchema.safeParse(await readJson(manifest));
    if (
      !parsed.success ||
      entry.name !== parsed.data.id + (legacyFailure ? ".failed.json" : "")
    )
      throw new AccessError(
        "storage_failure",
        "A download manifest is invalid. Inspect the artifacts directory; it has not been removed.",
        "doctor",
      );
    const artifact = parsed.data;
    if (artifact.status === "saving") {
      artifact.status = "failed";
      artifact.error = "download_interrupted";
      artifact.failureReason =
        "The previous worker stopped before it recorded a completed download. Partial files were retained for inspection.";
      await atomicJson(manifest, artifact);
    }
    if (artifact.status === "complete") {
      if (
        !artifact.path ||
        path.dirname(artifact.path) !== folder ||
        artifact.size === null ||
        !artifact.sha256
      )
        throw new AccessError(
          "storage_failure",
          "A completed download manifest has invalid file details.",
          "doctor",
        );
      const info = await stat(artifact.path).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        },
      );
      if (!info?.isFile() || info.size !== artifact.size) {
        artifact.status = "failed";
        artifact.error = "artifact_unavailable";
        artifact.failureReason =
          "The previously saved file is missing or its size changed. The manifest retains its original path and hash.";
      }
    }
    artifacts.set(artifact.id, artifact);
  }
  return [...artifacts.values()].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}
