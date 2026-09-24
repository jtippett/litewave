import path from "node:path";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { AccessError } from "./protocol.js";
import { exists, readJson, type Registration } from "./storage.js";

export type BrowserOpenOptions = {
  freshProfile?: boolean;
  storageState?: string;
};
export const QUALIFIED_BROWSER_VERSION = "151.0.7922.34";
const driverVersion = (
  createRequire(import.meta.url)("playwright/package.json") as {
    version: string;
  }
).version;

export async function selectProfile(
  r: Registration,
  options: BrowserOpenOptions,
) {
  if (driverVersion !== "1.62.0")
    throw new AccessError(
      "browser_version_mismatch",
      "The installed Playwright driver differs from Litewave's qualified pin. Run npm ci before opening a browser.",
      "doctor",
    );
  if (options.storageState && !options.freshProfile)
    throw new AccessError(
      "invalid_request",
      "--storage-state requires --fresh-profile; importing authentication must not overwrite an existing profile.",
    );
  const selection = path.join(r.directory, "browser-profile.json");
  let name = "profile";
  if (options.freshProfile) name = `profile-${randomUUID()}`;
  else if (await exists(selection)) {
    const saved = await readJson<{ name: string }>(selection);
    if (
      !saved ||
      typeof saved.name !== "string" ||
      !/^profile(?:-[a-f0-9-]{36})?$/.test(saved.name)
    )
      throw new AccessError(
        "storage_failure",
        "The browser profile selection is invalid.",
        "doctor",
      );
    name = saved.name;
  }
  const directory = path.join(r.directory, name);
  const lastVersion = await readFile(
    path.join(directory, "Last Version"),
    "utf8",
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (
    lastVersion !== null &&
    (!/^\d+\.\d+\.\d+\.\d+\s*$/.test(lastVersion) ||
      Number(lastVersion.split(".")[0]) >
        Number(QUALIFIED_BROWSER_VERSION.split(".")[0]))
  )
    throw new AccessError(
      "profile_version_incompatible",
      "This profile was used by a newer or unrecognized Chromium version. It has not been opened. Run stop, then browser open --fresh-profile to keep it intact and create a compatible profile. Sign in again, or explicitly import a Playwright storage-state file with --storage-state PATH.",
      "doctor",
    );
  return { name, directory };
}
