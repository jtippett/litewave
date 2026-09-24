import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  atomicJson,
  projectDirectory,
  projectKey,
  readJson,
  register,
  runtimeSocketPath,
  type Registration,
  type RuntimeDescriptor,
} from "../src/storage.js";
import {
  callPhoenix,
  resolveRuntime,
  setupPhoenix,
  type PhoenixConnection,
  type PhoenixTool,
} from "../src/phoenix.js";

type Fixture = {
  calls: number;
  mode: string;
  authorization: string;
  handler: (req: IncomingMessage, res: ServerResponse) => void;
};
function fixture(project: string, projectId: string): Fixture {
  const f: Fixture = {
    calls: 0,
    mode: "healthy",
    authorization: "",
    handler: (req, res) => {
      f.calls++;
      f.authorization = req.headers.authorization ?? "";
      if (f.mode === "drop") {
        req.socket.destroy();
        return;
      }
      if (f.mode === "redirect") {
        res.writeHead(307, { location: "http://127.0.0.1:1/leak" });
        res.end();
        return;
      }
      if (f.mode === "large") {
        res.end("x".repeat(1_048_577));
        return;
      }
      if (f.mode === "garbage") {
        res.setHeader("content-type", "application/json");
        res.end("not json{");
        return;
      }
      if (f.mode === "slow") {
        res.setHeader("content-type", "application/json");
        const interval = setInterval(() => res.write("."), 300);
        req.socket.once("close", () => clearInterval(interval));
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          protocol_version: 1,
          project_id: f.mode === "wrong-project" ? "different" : projectId,
          project,
          runtime_id: "instance-1",
          capabilities: [],
          app_url: "http://localhost:4123",
          status: "ok",
        }),
      );
    },
  };
  return f;
}
function withHome(root: string) {
  const previous = process.env.LITEWAVE_HOME;
  process.env.LITEWAVE_HOME = path.join(root, "s");
  return () => {
    if (previous === undefined) delete process.env.LITEWAVE_HOME;
    else process.env.LITEWAVE_HOME = previous;
  };
}

test("socket transport: descriptor resolution, identity checks, bounds, lost responses, stale and malformed descriptors", async () => {
  const root = await mkdtemp("/tmp/lw-s-");
  const restore = withHome(root);
  const project = await realpath(root);
  const projectId = projectKey(project);
  const f = fixture(project, projectId);
  const server = createServer(f.handler);
  const socketPath = runtimeSocketPath(project);
  await mkdir(path.dirname(socketPath), { recursive: true, mode: 0o700 });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  const descriptorFile = path.join(projectDirectory(project), "runtime.json");
  const descriptor: RuntimeDescriptor = {
    version: 1,
    project,
    project_id: projectId,
    runtime_id: "instance-1",
    os_pid: process.pid,
    socket: socketPath,
    started_at: new Date().toISOString(),
    capabilities: ["get_docs"],
  };
  try {
    assert.equal(
      (await callPhoenix(project, "phoenix_health")).error?.code,
      "phoenix_not_configured",
    );
    await atomicJson(descriptorFile, descriptor);
    const target = await resolveRuntime(project);
    assert.equal(target.kind, "socket");
    const health = await callPhoenix(project, "phoenix_health");
    assert.equal(health.runtime_id, "instance-1");
    assert.equal(health.app_url, "http://localhost:4123");
    assert.equal(f.authorization, "", "no token on the socket transport");

    f.mode = "wrong-project";
    assert.equal(
      (await callPhoenix(project, "phoenix_health")).error?.code,
      "project_mismatch",
    );
    f.mode = "redirect";
    let before = f.calls;
    assert.equal(
      (await callPhoenix(project, "phoenix_health")).error?.code,
      "permission_denied",
    );
    assert.equal(f.calls, before + 1);
    f.mode = "drop";
    before = f.calls;
    const lost = await callPhoenix(project, "project_eval", {
      code: ":ok",
      runtime_id: "instance-1",
      request_id: "stable-id",
    });
    assert.equal(lost.status, "outcome_unknown");
    assert.equal(lost.error?.dispatch_occurred, "unknown");
    assert.equal(f.calls, before + 1);
    f.mode = "large";
    assert.equal(
      (await callPhoenix(project, "phoenix_health")).error?.code,
      "response_too_large",
    );

    // A 2xx body that isn't JSON is a lost-response case for a mutation
    // (the server may have already applied it), not "never dispatched".
    f.mode = "garbage";
    const garbageMutation = await callPhoenix(project, "project_eval", {
      code: ":ok",
      runtime_id: "instance-1",
      request_id: "garbage-id",
    });
    assert.equal(garbageMutation.status, "outcome_unknown");
    assert.equal(garbageMutation.error?.dispatch_occurred, "unknown");
    const garbageHealth = await callPhoenix(project, "phoenix_health");
    assert.equal(garbageHealth.status, "error");
    assert.equal(garbageHealth.error?.code, "invalid_response");

    // An idle timeout alone won't catch a peer trickling bytes forever; the
    // hard deadline must still cut the call off close to the budget.
    f.mode = "slow";
    const slowStart = Date.now();
    const slow = await callPhoenix(project, "phoenix_health");
    const elapsed = Date.now() - slowStart;
    assert.equal(slow.error?.code, "runtime_unavailable");
    assert.ok(elapsed < 4000, `expected < 4000ms, took ${elapsed}ms`);

    f.mode = "healthy";

    // Descriptor pointing somewhere other than the derived socket is rejected.
    await atomicJson(descriptorFile, {
      ...descriptor,
      socket: "/tmp/elsewhere.sock",
    });
    assert.equal(
      (await callPhoenix(project, "phoenix_health")).error?.code,
      "permission_denied",
    );
    await atomicJson(descriptorFile, { ...descriptor, project: "/other" });
    assert.equal(
      (await callPhoenix(project, "phoenix_health")).error?.code,
      "permission_denied",
    );

    // Malformed descriptor is a structured error, not a crash.
    await writeFile(descriptorFile, "{not json", { mode: 0o600 });
    const malformed = await callPhoenix(project, "phoenix_health");
    assert.equal(malformed.error?.code, "runtime_unavailable");
    assert.match(malformed.error?.message ?? "", /descriptor/);

    // Stale descriptor: socket refuses because the app is down.
    await atomicJson(descriptorFile, descriptor);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const down = await callPhoenix(project, "phoenix_health");
    assert.equal(down.status, "error");
    assert.equal(down.error?.code, "runtime_unavailable");
    assert.match(down.error?.message ?? "", /not running|down/);
    const downMutation = await callPhoenix(project, "project_eval", {
      code: ":ok",
      runtime_id: "instance-1",
      request_id: "never-sent",
    });
    assert.equal(
      downMutation.status,
      "error",
      "refused connections were never dispatched",
    );
    assert.equal(downMutation.error?.dispatch_occurred, false);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    restore();
    await rm(root, { recursive: true, force: true });
  }
});

test("http fallback: setup is private and idempotent, writes the project key, and verifies the token file", async () => {
  const root = await mkdtemp("/tmp/lw-h-");
  const restore = withHome(root);
  const project = await realpath(root);
  let registration: Registration | undefined;
  const f = fixture(project, projectKey(project));
  const server = createServer(f.handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    registration = await register(project, `http://127.0.0.1:${port}`);
    const configured = await setupPhoenix(registration);
    const connection = await readJson<PhoenixConnection>(
      path.join(registration.directory, "phoenix.json"),
    );
    assert.equal(connection.project_id, projectKey(registration.project));
    const secret = (await readFile(connection.token_file, "utf8")).trim();
    assert.equal((await stat(connection.token_file)).mode & 0o777, 0o600);
    assert.ok(!JSON.stringify(configured).includes(secret));
    assert.deepEqual(await setupPhoenix(registration), configured);
    const target = await resolveRuntime(project);
    assert.equal(target.kind, "http");
    assert.equal(
      (await callPhoenix(project, "phoenix_health")).runtime_id,
      "instance-1",
    );
    assert.equal(f.authorization, `Bearer ${secret}`);
    await chmod(connection.token_file, 0o644);
    const before = f.calls;
    assert.equal(
      (await callPhoenix(project, "phoenix_health")).error?.code,
      "permission_denied",
    );
    assert.equal(f.calls, before);
    assert.equal(
      (await callPhoenix(project, "__proto__" as PhoenixTool)).error?.code,
      "invalid_request",
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    restore();
    await rm(root, { recursive: true, force: true });
  }
});
