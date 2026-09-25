import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { AccessError } from "./protocol.js";
import { requestJson, TransportError } from "./http.js";
import {
  canonicalProject,
  exists,
  projectDirectory,
  projectKey,
  readJson,
  runtimeSocketPath,
  type Registration,
  type RuntimeDescriptor,
} from "./storage.js";

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
export type RuntimeTarget = { project: string; projectId: string } & (
  | { kind: "socket"; socketPath: string }
  | { kind: "endpoint"; endpoint: URL; tokenFile: string }
);

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
const literal = (text: string) => JSON.stringify(text).replaceAll("#{", "\\#{");
export async function setupPhoenix(r: Registration) {
  const file = path.join(r.directory, "phoenix.json");
  const runtimeEndpoint = endpoint(new URL("/litewave/runtime", r.app).href);
  const projectId = projectKey(r.project);
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
      project_id: projectId,
    };
    const fd = await open(file, "wx", 0o600);
    try {
      await fd.writeFile(JSON.stringify(connection, null, 2) + "\n");
      await fd.sync();
    } finally {
      await fd.close();
    }
  }
  const connection = await readJson<PhoenixConnection>(file);
  return {
    endpoint: connection.endpoint,
    project_id: projectId,
    plug: `if Mix.env() == :dev do\n  plug Litewave,\n    project: ${literal(r.project)},\n    endpoint: ${literal(new URL(connection.endpoint).origin)},\n    token_file: ${literal(connection.token_file)},\n    allow_eval: false,\n    allow_sql: false\nend`,
    next: "This HTTP transport is optional. The default is the Unix socket the litewave_phoenix dependency publishes at boot with no Plug or token. Use this Plug only if you want runtime access on the app's HTTP port; mount it before body parsers and restart the app once.",
  };
}

// Another user who controls the run directory or the socket could receive
// eval code and SQL. A missing path is left to the connection attempt, which
// fails before anything is sent (the app is down or has not published yet).
const denied = () =>
  new AccessError(
    "permission_denied",
    "Runtime socket directory or socket is not private to this user.",
  );
async function assertPrivateSocket(socket: string) {
  const info = async (file: string) =>
    lstat(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw denied();
    });
  const uid = process.getuid?.();
  const directory = await info(path.dirname(socket));
  if (!directory) return;
  if (
    !directory.isDirectory() ||
    directory.uid !== uid ||
    (directory.mode & 0o777) !== 0o700
  )
    throw denied();
  const file = await info(socket);
  if (file && (!file.isSocket() || file.uid !== uid)) throw denied();
}

async function resolveHttpTarget(
  canonical: string,
  projectId: string,
): Promise<RuntimeTarget> {
  const config = await readJson<PhoenixConnection>(
    path.join(projectDirectory(canonical), "phoenix.json"),
  );
  if (
    config.version !== 1 ||
    config.project_id !== projectId ||
    typeof config.token_file !== "string" ||
    !path.isAbsolute(config.token_file)
  )
    throw new AccessError(
      "permission_denied",
      "Phoenix connection identity is invalid.",
    );
  return {
    kind: "endpoint",
    project: canonical,
    projectId,
    endpoint: endpoint(config.endpoint),
    tokenFile: config.token_file,
  };
}

export async function resolveRuntime(project: string): Promise<RuntimeTarget> {
  const canonical = await canonicalProject(project);
  const projectId = projectKey(canonical);
  const directory = projectDirectory(canonical);
  const descriptorFile = path.join(directory, "runtime.json");
  if (await exists(descriptorFile)) {
    let d: RuntimeDescriptor;
    try {
      d = await readJson<RuntimeDescriptor>(descriptorFile);
    } catch (error) {
      if (error instanceof AccessError) throw error;
      throw new AccessError(
        "runtime_unavailable",
        "The runtime descriptor is unreadable. Restart the app to republish it.",
        "doctor",
      );
    }
    if (
      d.version !== 1 ||
      d.project !== canonical ||
      d.project_id !== projectId ||
      d.socket !== runtimeSocketPath(canonical) ||
      typeof d.os_pid !== "number"
    )
      throw new AccessError(
        "permission_denied",
        "Runtime descriptor identity is invalid.",
      );
    await assertPrivateSocket(d.socket);
    return {
      kind: "socket",
      project: canonical,
      projectId,
      socketPath: d.socket,
    };
  }
  if (await exists(path.join(directory, "phoenix.json")))
    return resolveHttpTarget(canonical, projectId);
  throw new AccessError(
    "phoenix_not_configured",
    "No Litewave runtime is published for this project. Add the litewave_phoenix dependency to the app and restart it, or run litewave phoenix setup --project PATH for the HTTP transport.",
    "doctor",
  );
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
  project: string,
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
  let target: RuntimeTarget;
  try {
    target = await resolveRuntime(project);
    const args = parsed.data as Record<string, unknown>;
    const body =
      method === "phoenix_health"
        ? undefined
        : JSON.stringify({
            ...args,
            method,
            project_id: target.projectId,
            request_id: args.request_id ?? randomUUID(),
          });
    if (body && Buffer.byteLength(body) > 65_536)
      return runtimeFailure(
        "request_too_large",
        "Runtime requests must fit within 64 KiB.",
      );
    const send = async (t: RuntimeTarget) => {
      const headers: Record<string, string> = body
        ? { "content-type": "application/json" }
        : {};
      if (t.kind === "endpoint")
        headers.authorization = `Bearer ${await token(t.tokenFile)}`;
      return requestJson(
        t.kind === "socket"
          ? { socketPath: t.socketPath, path: "/litewave/runtime" }
          : { url: t.endpoint },
        {
          method: body ? "POST" : "GET",
          body,
          headers,
          timeoutMs: method === "phoenix_health" ? 2000 : 35_000,
        },
      );
    };
    let response: Awaited<ReturnType<typeof send>>;
    try {
      response = await send(target);
    } catch (error) {
      // runtime.json outlives an app stopped by Ctrl-C or mix run (halt skips
      // cleanup), so a dead socket must not hide a configured HTTP transport.
      // Retrying is safe only because nothing reached the runtime.
      if (
        target.kind === "socket" &&
        error instanceof TransportError &&
        !error.sent &&
        (await exists(
          path.join(projectDirectory(target.project), "phoenix.json"),
        ))
      ) {
        target = await resolveHttpTarget(target.project, target.projectId);
        try {
          response = await send(target);
        } catch (fallbackError) {
          if (fallbackError instanceof TransportError && !fallbackError.sent)
            throw new TransportError(
              "connection_failed",
              `socket: ${error.message}; endpoint: ${fallbackError.message}`,
              false,
            );
          throw fallbackError;
        }
      } else throw error;
    }
    if (response.status >= 300 && response.status < 400)
      return runtimeFailure(
        "permission_denied",
        "Runtime redirects are not followed.",
        mutation,
      );
    if (response.status < 200 || response.status >= 300)
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
    let result: PhoenixResult;
    try {
      result = JSON.parse(response.body) as PhoenixResult;
    } catch {
      return runtimeFailure(
        "invalid_response",
        "Runtime returned a response that is not JSON.",
        mutation,
      );
    }
    if (
      result.project_id !== target.projectId ||
      typeof result.runtime_id !== "string" ||
      result.protocol_version !== 1
    )
      return runtimeFailure(
        "project_mismatch",
        "The responding runtime identity does not match this project.",
        mutation,
      );
    if (method === "phoenix_health" && result.project !== target.project)
      return runtimeFailure(
        "project_mismatch",
        "The responding runtime has a different project directory.",
      );
    return result;
  } catch (error) {
    if (error instanceof AccessError)
      return runtimeFailure(error.code, error.message);
    if (error instanceof TransportError) {
      if (error.code === "response_too_large")
        return runtimeFailure(error.code, error.message, mutation);
      if (!error.sent)
        return runtimeFailure(
          "runtime_unavailable",
          `No runtime answered (${error.message}); the app is not running or has not published its runtime yet. Restart the app, then retry.`,
        );
      return runtimeFailure(
        "runtime_unavailable",
        mutation
          ? "The runtime response was lost. Inspect runtime_action_status with the original request_id and runtime_id; do not replay automatically."
          : "The runtime response was lost.",
        mutation,
      );
    }
    return runtimeFailure(
      "runtime_unavailable",
      "Phoenix runtime is unavailable. Check installation and whether the app is running.",
    );
  }
}
