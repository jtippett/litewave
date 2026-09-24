import { BrowserWorker } from "./browser.js";
import { registration } from "./storage.js";
import { serve } from "./transport.js";
import { AccessError, failure } from "./protocol.js";

process.umask(0o077);
const r = await registration(process.argv[2]!);
const worker = new BrowserWorker(r);
let ready = false;
let startupError: unknown;
// Bind before launching: the socket arbitrates concurrent open calls without deleting a lock.
await serve(r, (op) =>
  ready || (startupError !== undefined && op.method === "stop")
    ? worker.execute(op)
    : Promise.resolve(
        failure(
          op.requestId,
          startupError ??
            new AccessError("starting", "Browser worker is starting."),
        ),
      ),
);
try {
  const stateArgument = process.argv.indexOf("--storage-state");
  await worker.open(process.argv.includes("--headless"), {
    freshProfile: process.argv.includes("--fresh-profile"),
    storageState:
      stateArgument === -1 ? undefined : process.argv[stateArgument + 1],
  });
  ready = true;
} catch (error) {
  console.error(
    error instanceof AccessError
      ? `${error.code}: ${error.message}`
      : "Worker startup failed.",
  );
  await worker.close().catch(() => undefined);
  // Keep the authenticated endpoint available for diagnosis and explicit stop.
  // Otherwise startup errors disappear before the opening client can observe them.
  startupError = error;
}
