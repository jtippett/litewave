import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { loadArtifacts, type Artifact } from "../src/artifacts.js";
import { atomicJson, privateDir } from "../src/storage.js";

test("artifact recovery retains completed files and makes interrupted, missing and invalid records explicit", async () => {
  const root = await mkdtemp("/tmp/lw-artifacts-");
  try {
    const id = randomUUID();
    const directory = path.join(root, id);
    await privateDir(directory);
    const file = path.join(directory, "result.txt");
    await writeFile(file, "saved");
    const artifact: Artifact = {
      id,
      tabId: "old-tab",
      actionId: "old-action",
      status: "complete",
      suggestedFilename: "result.txt",
      path: file,
      size: 5,
      sha256: "a".repeat(64),
      error: null,
      failureReason: null,
      createdAt: new Date().toISOString(),
    };
    await atomicJson(path.join(directory, "manifest.json"), artifact);
    assert.deepEqual(await loadArtifacts(root), [artifact]);
    await rm(file);
    const missing = (await loadArtifacts(root))[0]!;
    assert.equal(missing.error, "artifact_unavailable");
    assert.equal(missing.path, file);
    assert.equal(missing.sha256, artifact.sha256);
    await atomicJson(path.join(directory, "manifest.json"), {
      ...artifact,
      status: "saving",
      path: null,
      size: null,
      sha256: null,
    });
    assert.equal((await loadArtifacts(root))[0]!.error, "download_interrupted");
    assert.equal((await loadArtifacts(root))[0]!.error, "download_interrupted");
    await atomicJson(path.join(directory, "manifest.json"), {
      ...artifact,
      path: path.join(root, "outside.txt"),
    });
    await assert.rejects(loadArtifacts(root), { code: "storage_failure" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
