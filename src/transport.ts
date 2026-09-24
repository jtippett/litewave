import { connect, createServer, type Server } from "node:net";
import { chmod } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import {
  AccessError,
  failure,
  operationSchema,
  type Envelope,
  type Operation,
} from "./protocol.js";
import type { Registration } from "./storage.js";

const MAX_BYTES = 1_048_576;
export async function serve(
  r: Registration,
  execute: (op: Operation) => Promise<Envelope>,
): Promise<Server> {
  const server = createServer((socket) => {
    let data = "";
    let handled = false;
    socket.setEncoding("utf8");
    socket.setTimeout(45_000, () => socket.destroy());
    socket.on("error", () => undefined);
    socket.on("data", (chunk) => {
      if (handled) return;
      data += chunk;
      if (Buffer.byteLength(data) > MAX_BYTES) {
        handled = true;
        socket.destroy();
        return;
      }
      if (!data.includes("\n")) return;
      handled = true;
      void (async () => {
        let requestId = "invalid";
        try {
          const request = JSON.parse(data.slice(0, data.indexOf("\n")));
          if (
            typeof request.token !== "string" ||
            Buffer.byteLength(request.token) !== Buffer.byteLength(r.token) ||
            !timingSafeEqual(Buffer.from(request.token), Buffer.from(r.token))
          )
            throw new AccessError(
              "permission_denied",
              "Worker authentication failed.",
            );
          if (request.registrationId !== r.id)
            throw new AccessError(
              "permission_denied",
              "Worker registration does not match.",
            );
          const parsed = operationSchema.safeParse(request.operation);
          if (!parsed.success)
            throw new AccessError(
              "invalid_request",
              "Invalid operation arguments.",
            );
          requestId = parsed.data.requestId;
          const result = await execute(parsed.data);
          // A disconnected client cannot cancel or replay an action.
          if (!socket.destroyed) socket.end(JSON.stringify(result) + "\n");
          if (
            parsed.data.method === "stop" &&
            result.status === "ok" &&
            server.listening
          )
            server.close();
        } catch (error) {
          if (!socket.destroyed)
            socket.end(JSON.stringify(failure(requestId, error)) + "\n");
        }
      })();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(r.socket, () => {
      server.off("error", reject);
      resolve();
    });
  });
  await chmod(r.socket, 0o600);
  return server;
}
export function rpc(
  r: Registration,
  operation: Operation,
  timeoutMs = 40_000,
): Promise<Envelope> {
  return new Promise((resolve, reject) => {
    const socket = connect(r.socket);
    let data = "";
    let sent = false;
    let done = false;
    const fail = () => {
      if (done) return;
      done = true;
      socket.destroy();
      reject(
        new AccessError(
          sent ? "connection_lost" : "worker_unavailable",
          sent
            ? "The worker response was lost. Check action_status using the same request ID; do not resubmit with a new ID."
            : "No verified worker is available. Run browser open or doctor.",
          sent ? "action_status" : "doctor",
        ),
      );
    };
    socket.setEncoding("utf8");
    socket.setTimeout(timeoutMs, fail);
    socket.on("error", fail);
    socket.on("end", () => {
      if (!done) fail();
    });
    socket.on("connect", () => {
      sent = true;
      socket.write(
        JSON.stringify({ token: r.token, registrationId: r.id, operation }) +
          "\n",
      );
    });
    socket.on("data", (chunk) => {
      data += chunk;
      if (Buffer.byteLength(data) > MAX_BYTES) {
        fail();
        return;
      }
      if (!data.includes("\n")) return;
      try {
        const result = JSON.parse(
          data.slice(0, data.indexOf("\n")),
        ) as Envelope;
        done = true;
        socket.destroy();
        resolve(result);
      } catch {
        fail();
      }
    });
  });
}
