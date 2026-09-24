import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { AccessError } from "./protocol.js";
import { exists, readJson, type Registration } from "./storage.js";

const requestId = z.string().min(1).max(200);
const timeout = z.number().int().min(1).max(30_000).optional();
const execution = {
  request_id: requestId,
  runtime_id: z.string().min(1),
  timeout,
};
export const phoenixTools = {
  phoenix_health: {
    description:
      "Inspect the registered Phoenix runtime, capabilities, repository names, and runtime_id. Works without an open browser.",
    schema: z.object({}).strict(),
  },
  get_docs: {
    description:
      "Read module/function documentation from the application's installed versions; supports c:Module.callback/arity.",
    schema: z.object({ reference: z.string().min(1).max(500) }).strict(),
  },
  get_source_location: {
    description:
      "Find source for Module, Module.function/arity, or dep:package within the project's allowed roots.",
    schema: z.object({ reference: z.string().min(1).max(500) }).strict(),
  },
  get_logs: {
    description:
      "Read a bounded log buffer. grep is a case-insensitive literal substring. Continue with next_cursor; gap reports overwritten entries.",
    schema: z
      .object({
        tail: z.number().int().min(1).max(200).optional(),
        cursor: z.number().int().nonnegative().optional(),
        grep: z.string().max(200).optional(),
        level: z
          .enum([
            "emergency",
            "alert",
            "critical",
            "error",
            "warning",
            "notice",
            "info",
            "debug",
          ])
          .optional(),
      })
      .strict(),
  },
  project_eval: {
    description:
      "Evaluate Elixir in the running app, with IEx helpers and arguments binding. Requires allow_eval. Can mutate state; it is not a sandbox. Obtain runtime_id from phoenix_health and use a stable request_id. Never retry with a new ID after transport loss.",
    schema: z
      .object({
        ...execution,
        code: z.string().max(32_000),
        arguments: z.array(z.unknown()).optional(),
      })
      .strict(),
  },
  execute_sql_query: {
    description:
      "Run a parameterized query against an allowed Ecto repository. Requires allow_sql. SQL is READ-WRITE, matching Tidewave parity. Output is bounded; query results can still consume database/client memory. Obtain runtime_id from phoenix_health and use a stable request_id.",
    schema: z
      .object({
        ...execution,
        query: z.string().max(32_000),
        arguments: z.array(z.unknown()).optional(),
        repo: z.string().max(200).optional(),
      })
      .strict(),
  },
  runtime_action_status: {
    description:
      "Inspect an evaluation or SQL request after a lost response without dispatching it again. A changed runtime cannot confirm an old request's outcome.",
    schema: z
      .object({ runtime_id: z.string().min(1), action_id: requestId })
      .strict(),
  },
} as const;
export type PhoenixTool = keyof typeof phoenixTools;
export type PhoenixConnection = {
  version: 1;
  endpoint: string;
  token_file: string;
  project_id: string;
};
export type PhoenixResult = {
  status?: string;
  error?: {
    code: string;
    message: string;
    dispatch_occurred: boolean | "unknown";
  } | null;
  [key: string]: unknown;
};

function endpoint(value: string) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/litewave/runtime"
  ) {
    throw new AccessError(
      "permission_denied",
      "Phoenix access requires an explicit loopback runtime endpoint.",
    );
  }
  return url;
}
export async function setupPhoenix(r: Registration) {
  const file = path.join(r.directory, "phoenix.json");
  const runtimeEndpoint = endpoint(new URL("/litewave/runtime", r.app).href);
  if (!(await exists(file))) {
    const tokenFile = path.join(r.directory, "phoenix-token");
    // Exclusive creation prevents replacing a token already used by an app.
    if (!(await exists(tokenFile))) {
      const fd = await open(tokenFile, "wx", 0o600);
      try {
        await fd.writeFile(randomBytes(32).toString("hex") + "\n");
        await fd.sync();
      } finally {
        await fd.close();
      }
    }
    const connection: PhoenixConnection = {
      version: 1,
      endpoint: runtimeEndpoint.href,
      token_file: tokenFile,
      project_id: r.id,
    };
    const fd = await open(file, "wx", 0o600);
    try {
      await fd.writeFile(JSON.stringify(connection, null, 2) + "\n");
      await fd.sync();
    } finally {
      await fd.close();
    }
  }
  const connection = await phoenixConnection(r);
  const literal = (text: string) =>
    JSON.stringify(text).replaceAll("#{", "\\#{");
  return {
    endpoint: connection.endpoint,
    project_id: r.id,
    plug: `if Mix.env() == :dev do\n  plug Litewave,\n    project: ${literal(r.project)},\n    project_id: ${literal(r.id)},\n    endpoint: ${literal(new URL(connection.endpoint).origin)},\n    token_file: ${literal(connection.token_file)},\n    allow_eval: false,\n    allow_sql: false\nend`,
    next: "Add the development-only litewave_phoenix dependency and this Plug before body parsers. The app owner must restart the app once to load the dependency. Evaluation and SQL remain disabled until explicitly enabled in the Plug.",
  };
}
export async function phoenixConnection(r: Registration) {
  const file = path.join(r.directory, "phoenix.json");
  if (!(await exists(file)))
    throw new AccessError(
      "phoenix_not_configured",
      "Run litewave phoenix setup --project PATH first.",
    );
  const config = await readJson<PhoenixConnection>(file);
  if (
    config.version !== 1 ||
    config.project_id !== r.id ||
    typeof config.token_file !== "string" ||
    !path.isAbsolute(config.token_file)
  )
    throw new AccessError(
      "permission_denied",
      "Phoenix connection identity is invalid.",
    );
  endpoint(config.endpoint);
  return config;
}
async function token(file: string) {
  const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await fd.stat();
    if (
      !info.isFile() ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o077) !== 0 ||
      info.size > 257
    )
      throw new AccessError(
        "permission_denied",
        "Phoenix token file must be private, regular, and owned by this user.",
      );
    const secret = (await fd.readFile("utf8")).trim();
    if (!/^[a-f0-9]{64}$/.test(secret))
      throw new AccessError("permission_denied", "Invalid Phoenix token file.");
    return secret;
  } finally {
    await fd.close();
  }
}
function runtimeFailure(
  code: string,
  message: string,
  unknown = false,
): PhoenixResult {
  return {
    status: unknown ? "outcome_unknown" : "error",
    result: null,
    error: { code, message, dispatch_occurred: unknown ? "unknown" : false },
  };
}
export async function callPhoenix(
  r: Registration,
  method: PhoenixTool,
  input: unknown = {},
): Promise<PhoenixResult> {
  if (!Object.hasOwn(phoenixTools, method))
    return runtimeFailure("invalid_request", "Unknown Phoenix tool.");
  const parsed = phoenixTools[method]?.schema.safeParse(input);
  if (!parsed?.success)
    return runtimeFailure(
      "invalid_request",
      "Invalid Phoenix tool or arguments.",
    );
  const mutation = ["project_eval", "execute_sql_query"].includes(method);
  let sent = false;
  try {
    const config = await phoenixConnection(r);
    const secret = await token(config.token_file);
    const args = parsed.data as Record<string, unknown>;
    const body =
      method === "phoenix_health"
        ? undefined
        : JSON.stringify({
            ...args,
            method,
            project_id: r.id,
            request_id: args.request_id ?? randomUUID(),
          });
    if (body && Buffer.byteLength(body) > 65_536)
      return runtimeFailure(
        "request_too_large",
        "Runtime requests must fit within 64 KiB.",
      );
    sent = true;
    const response = await fetch(config.endpoint, {
      method: body ? "POST" : "GET",
      body,
      headers: {
        authorization: `Bearer ${secret}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      redirect: "manual",
      signal: AbortSignal.timeout(method === "phoenix_health" ? 2000 : 35_000),
    });
    if (response.status >= 300 && response.status < 400)
      return runtimeFailure(
        "permission_denied",
        "Runtime redirects are not followed.",
        mutation,
      );
    if (!response.ok)
      return runtimeFailure(
        response.status === 403 ? "permission_denied" : "runtime_http_error",
        `Runtime returned HTTP ${response.status}.`,
        mutation && response.status >= 500,
      );
    if (!response.body)
      return runtimeFailure(
        "invalid_response",
        "Runtime returned an empty response.",
        mutation,
      );
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 1_048_576) {
        await reader.cancel();
        return runtimeFailure(
          "response_too_large",
          "Runtime response exceeded 1 MiB.",
          mutation,
        );
      }
      chunks.push(chunk.value);
    }
    const result = JSON.parse(
      Buffer.concat(chunks).toString("utf8"),
    ) as PhoenixResult;
    if (
      result.project_id !== r.id ||
      typeof result.runtime_id !== "string" ||
      result.protocol_version !== 1
    )
      return runtimeFailure(
        "project_mismatch",
        "The responding runtime identity does not match this registration.",
        mutation,
      );
    if (method === "phoenix_health" && result.project !== r.project)
      return runtimeFailure(
        "project_mismatch",
        "The responding runtime has a different project directory.",
      );
    return result;
  } catch (error) {
    if (error instanceof AccessError)
      return runtimeFailure(error.code, error.message);
    return runtimeFailure(
      "runtime_unavailable",
      mutation && sent
        ? "The runtime response was lost. Inspect runtime_action_status with the original request_id and runtime_id; do not replay automatically."
        : "Phoenix runtime is unavailable. Check installation, token permissions, and whether the app is running.",
      mutation && sent,
    );
  }
}
