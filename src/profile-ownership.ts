import path from "node:path";
import { readlink } from "node:fs/promises";
import { hostname } from "node:os";
import { AccessError } from "./protocol.js";
import { readJson, type Registration } from "./storage.js";

export async function profileLockOwner(
  profile: string,
): Promise<string | null> {
  return readlink(path.join(profile, "SingletonLock")).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw new AccessError(
        "profile_in_use",
        "The profile lock cannot be verified. Inspect its owner manually.",
        "doctor",
      );
    },
  );
}
function processIsAbsent(pid: number) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

export async function assertProfileAvailable(r: Registration, profile: string) {
  const owner = await profileLockOwner(profile);
  if (!owner) return;
  const session = await readJson<{
    projectId?: string;
    profile?: string;
    state?: string;
    lockOwner?: string;
  } | null>(path.join(r.directory, "session.json")).catch(() => null);
  const pidText = owner.startsWith(hostname() + "-")
    ? owner.slice(hostname().length + 1)
    : "";
  // A dead PID alone is insufficient. The lock must also match the last
  // authenticated launch in this registration, with a persisted close observation.
  // Chromium then performs its own atomic ProcessSingleton check during launch.
  // Litewave never unlinks a profile lock or terminates a process here.
  if (
    session?.projectId === r.id &&
    session.profile === profile &&
    session.state === "closed" &&
    session.lockOwner === owner &&
    /^\d+$/.test(pidText) &&
    Number(pidText) > 1 &&
    processIsAbsent(Number(pidText))
  )
    return;
  throw new AccessError(
    "profile_in_use",
    "The dedicated profile has an unknown or still-running owner. Reuse its verified worker or inspect its owner manually.",
    "doctor",
  );
}
