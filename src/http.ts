// src/http.ts
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export type HttpTarget = { socketPath: string; path: string } | { url: URL };
export class TransportError extends Error {
  constructor(
    public code: "response_too_large" | "connection_failed",
    message: string,
    public sent: boolean,
  ) {
    super(message);
  }
}
const MAX_BYTES = 1_048_576;

export function requestJson(
  target: HttpTarget,
  init: {
    method: "GET" | "POST";
    body?: string;
    headers?: Record<string, string>;
    timeoutMs: number;
  },
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    let sent = false;
    let settled = false;
    let deadline: NodeJS.Timeout;
    const fail = (code: TransportError["code"], message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      reject(new TransportError(code, message, sent));
    };
    const headers = {
      ...(init.headers ?? {}),
      ...(init.body
        ? { "content-length": String(Buffer.byteLength(init.body)) }
        : {}),
    };
    // One connection per request: pooling would mask dropped connections and
    // share Unix sockets across targets.
    const options = {
      method: init.method,
      headers,
      timeout: init.timeoutMs,
      agent: false as const,
    };
    const req =
      "socketPath" in target
        ? httpRequest({
            ...options,
            socketPath: target.socketPath,
            path: target.path,
          })
        : (target.url.protocol === "https:" ? httpsRequest : httpRequest)(
            target.url,
            options,
          );
    // The socket "timeout" option above is an idle timeout: it only fires
    // when the connection goes quiet. A peer that trickles a byte now and
    // then never trips it, so this deadline enforces a hard total budget.
    deadline = setTimeout(() => {
      req.destroy();
      fail("connection_failed", "Runtime request timed out.");
    }, init.timeoutMs);
    req.on("socket", (socket) => {
      socket.once("connect", () => {
        sent = true;
      });
    });
    req.on("timeout", () => {
      req.destroy();
      fail("connection_failed", "Runtime request timed out.");
    });
    req.on("error", (error: NodeJS.ErrnoException) =>
      fail("connection_failed", error.code ?? error.message),
    );
    req.on("response", (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) {
          res.destroy();
          fail("response_too_large", "Runtime response exceeded 1 MiB.");
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
      res.on("error", () =>
        fail("connection_failed", "Runtime response was interrupted."),
      );
    });
    req.end(init.body);
  });
}
