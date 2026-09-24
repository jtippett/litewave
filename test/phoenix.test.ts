import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { register, readJson, type Registration } from "../src/storage.js";
import {
  callPhoenix,
  setupPhoenix,
  type PhoenixConnection,
  type PhoenixTool,
} from "../src/phoenix.js";

test("Phoenix setup is private and idempotent; runtime transport verifies identity and never retries writes", async () => {
  const root = await mkdtemp("/tmp/lw-runtime-");
  const previous = process.env.LITEWAVE_HOME;
  process.env.LITEWAVE_HOME = path.join(root, "state");
  let registration: Registration;
  let calls = 0;
  let mode = "healthy";
  let receivedAuthorization = "";
  const server = createServer(async (req, res) => {
    calls++;
    receivedAuthorization = req.headers.authorization ?? "";
    if (mode === "drop") {
      req.socket.destroy();
      return;
    }
    if (mode === "redirect") {
      res.writeHead(307, { location: "http://127.0.0.1:1/leak" });
      res.end();
      return;
    }
    if (mode === "large") {
      res.end("x".repeat(1_048_577));
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        protocol_version: 1,
        project_id: mode === "wrong-project" ? "different" : registration.id,
        project: registration.project,
        runtime_id: "instance-1",
        capabilities: [],
        status: "ok",
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    registration = await register(root, `http://127.0.0.1:${port}`);
    const absent = await callPhoenix(registration, "phoenix_health");
    assert.equal(absent.error?.code, "phoenix_not_configured");
    const configured = await setupPhoenix(registration);
    const connection = await readJson<PhoenixConnection>(
      path.join(registration.directory, "phoenix.json"),
    );
    const secret = (await readFile(connection.token_file, "utf8")).trim();
    assert.equal((await stat(connection.token_file)).mode & 0o777, 0o600);
    assert.ok(!JSON.stringify(configured).includes(secret));
    assert.deepEqual(await setupPhoenix(registration), configured);
    assert.equal(await readFile(connection.token_file, "utf8"), secret + "\n");
    assert.equal(
      (await callPhoenix(registration, "phoenix_health")).runtime_id,
      "instance-1",
    );
    assert.equal(receivedAuthorization, `Bearer ${secret}`);
    mode = "wrong-project";
    assert.equal(
      (await callPhoenix(registration, "phoenix_health")).error?.code,
      "project_mismatch",
    );
    mode = "redirect";
    let before = calls;
    assert.equal(
      (await callPhoenix(registration, "phoenix_health")).error?.code,
      "permission_denied",
    );
    assert.equal(calls, before + 1);
    mode = "drop";
    before = calls;
    const lost = await callPhoenix(registration, "project_eval", {
      code: ":ok",
      runtime_id: "instance-1",
      request_id: "stable-id",
    });
    assert.equal(lost.status, "outcome_unknown");
    assert.equal(lost.error?.dispatch_occurred, "unknown");
    assert.equal(calls, before + 1);
    mode = "large";
    assert.equal(
      (await callPhoenix(registration, "phoenix_health")).error?.code,
      "response_too_large",
    );
    await chmod(connection.token_file, 0o644);
    before = calls;
    assert.equal(
      (await callPhoenix(registration, "phoenix_health")).error?.code,
      "permission_denied",
    );
    assert.equal(calls, before);
    assert.equal(
      (await callPhoenix(registration, "__proto__" as PhoenixTool)).error?.code,
      "invalid_request",
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previous === undefined) delete process.env.LITEWAVE_HOME;
    else process.env.LITEWAVE_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
});
