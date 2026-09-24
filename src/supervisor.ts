import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { AccessError, type Envelope } from "./protocol.js";
import { exists, uploadPolicy, type Registration } from "./storage.js";
import { rpc } from "./transport.js";
import type { BrowserOpenOptions } from "./profile.js";
import { callPhoenix } from "./phoenix.js";

export async function openBrowser(
  r: Registration,
  headless = false,
  options: BrowserOpenOptions = {},
): Promise<Envelope> {
  if (options.storageState && !options.freshProfile)
    throw new AccessError(
      "invalid_request",
      "--storage-state requires --fresh-profile.",
    );
  const probe = () =>
    rpc(r, { method: "status", requestId: randomUUID() }, 1500);
  const existing = await probe().catch(() => null);
  if (existing) {
    if (options.freshProfile)
      throw new AccessError(
        "needs_attention",
        "A worker already exists. Finish pending actions and run stop before opening a fresh profile.",
        "stop",
      );
    if (existing.error?.code === "starting") {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        await delay(200);
        const ready = await probe().catch(() => null);
        if (ready && !ready.error) return ready;
        if (ready?.error && ready.error.code !== "starting")
          throw new AccessError(
            ready.error.code,
            ready.error.message,
            ready.error.nextOperation,
          );
        if (!ready || ready.error?.code !== "starting") break;
      }
      throw new AccessError(
        "worker_unavailable",
        "An existing worker did not become ready. Inspect worker.log.",
        "doctor",
      );
    }
    if (existing.error)
      throw new AccessError(
        existing.error.code,
        existing.error.message,
        existing.error.nextOperation,
      );
    if ((existing.result as { state: string }).state === "closing")
      throw new AccessError(
        "browser_closing",
        "Browser shutdown is in progress. Wait for stop to finish before opening a replacement.",
        "status",
      );
    if ((existing.result as { state: string }).state === "closed")
      throw new AccessError(
        "browser_closed",
        "Browser was closed. Run stop, then browser open to create a replacement session.",
        "stop",
      );
    return existing;
  }
  if (await exists(r.socket))
    throw new AccessError(
      "needs_attention",
      "A socket exists but its owner cannot be verified. No lock was removed and no process was killed.",
      "doctor",
    );
  const log = await open(path.join(r.directory, "worker.log"), "a", 0o600);
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("./worker.js", import.meta.url)),
      r.project,
      ...(headless ? ["--headless"] : []),
      ...(options.freshProfile ? ["--fresh-profile"] : []),
      ...(options.storageState
        ? ["--storage-state", path.resolve(options.storageState)]
        : []),
    ],
    {
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
      env: process.env,
    },
  );
  let spawnError: Error | undefined;
  child.on("error", (error) => {
    spawnError = error;
  });
  child.unref();
  await log.close();
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (spawnError) break;
    const status = await probe().catch(() => null);
    if (status && !status.error) return status;
    if (status?.error && status.error.code !== "starting")
      throw new AccessError(
        status.error.code,
        status.error.message,
        status.error.nextOperation,
      );
    if (child.exitCode !== null) break;
    await delay(200);
  }
  throw new AccessError(
    "worker_unavailable",
    "Worker did not become ready. Inspect worker.log; no automatic restart was attempted.",
    "doctor",
  );
}
export async function doctor(r: Registration) {
  const browser = await rpc(
    r,
    { method: "status", requestId: randomUUID() },
    2000,
  ).catch(() => null);
  const app = await fetch(r.app, {
    method: "HEAD",
    redirect: "manual",
    signal: AbortSignal.timeout(2000),
  }).then(
    (res) => ({ reachable: true, httpStatus: res.status }),
    () => ({ reachable: false, httpStatus: null }),
  );
  return {
    project: r.project,
    uploads: uploadPolicy(r),
    app,
    phoenix: (await exists(path.join(r.directory, "phoenix.json")))
      ? await callPhoenix(r, "phoenix_health")
      : { status: "not_configured" },
    browser: browser?.result ?? {
      state: "unavailable",
      error: browser?.error ?? null,
    },
    login: "unknown",
    remedy: browser?.error
      ? browser.error.message
      : (browser?.result as { state?: string } | undefined)?.state === "ready"
        ? null
        : (browser?.result as { state?: string } | undefined)?.state ===
            "closed"
          ? "The browser closed. Inspect action_status and downloads, then run stop and browser open for a replacement session. Uncertain actions are not replayed."
          : "Run browser open. If it reports needs_attention, inspect the owning process and socket manually; Litewave does not remove unknown locks.",
  };
}
