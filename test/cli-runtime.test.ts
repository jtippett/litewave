import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { access, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  atomicJson,
  projectDirectory,
  projectKey,
  runtimeSocketPath,
  registration,
} from "../src/storage.js";
import { playwrightCli } from "../src/supervisor.js";

const run = promisify(execFile);
const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));

test("runtime tools work without a browser registration; init defaults --app from the runtime", async () => {
  const root = await mkdtemp("/tmp/lw-c-");
  const home = path.join(root, "s");
  const project = await realpath(root);
  const projectId = projectKey(project);
  const env = { ...process.env, LITEWAVE_HOME: home };
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        protocol_version: 1,
        project_id: projectId,
        project,
        runtime_id: "instance-1",
        capabilities: ["get_docs"],
        app_url: "http://localhost:4123",
        status: "ok",
      }),
    );
  });
  const previousHome = process.env.LITEWAVE_HOME;
  try {
    process.env.LITEWAVE_HOME = home;
    const socketPath = runtimeSocketPath(project);
    await mkdir(path.dirname(socketPath), { recursive: true, mode: 0o700 });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    await atomicJson(path.join(projectDirectory(project), "runtime.json"), {
      version: 1,
      project,
      project_id: projectId,
      runtime_id: "instance-1",
      os_pid: process.pid,
      socket: socketPath,
      started_at: new Date().toISOString(),
      capabilities: ["get_docs"],
    });
    const status = await run(
      process.execPath,
      [cli, "phoenix", "status", "--project", project],
      { env },
    );
    assert.equal(JSON.parse(status.stdout).runtime_id, "instance-1");

    const client = new Client({ name: "cli-runtime-test", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cli, "mcp", "--project", project],
      env,
    });
    await client.connect(transport);
    try {
      const listed = await client.listTools();
      assert.ok(listed.tools.some((t) => t.name === "phoenix_health"));
      assert.ok(listed.tools.some((t) => t.name === "browser"));
      const health = await client.callTool({
        name: "phoenix_health",
        arguments: {},
      });
      assert.equal(
        (health.structuredContent as { runtime_id: string }).runtime_id,
        "instance-1",
      );
      const browser = await client.callTool({
        name: "browser",
        arguments: { method: "status", requestId: "no-registration" },
      });
      assert.equal(browser.isError, true);
      assert.equal(
        (browser.structuredContent as { error: { code: string } }).error.code,
        "not_registered",
      );
    } finally {
      await client.close();
    }

    const init = await run(
      process.execPath,
      [cli, "init", "--project", project],
      { env },
    );
    const printed = JSON.parse(init.stdout);
    assert.equal(printed.registration.app, "http://localhost:4123/");
    assert.equal(printed.mcpServers.litewave.env.LITEWAVE_HOME, home);
    assert.equal((await registration(project)).app, "http://localhost:4123/");

    // A relative LITEWAVE_HOME is printed resolved, so the MCP client that
    // copies the entry uses the same storage whatever its working directory.
    const relativeInit = await run(
      process.execPath,
      [cli, "init", "--project", project, "--app", "http://localhost:4123"],
      { env: { ...process.env, LITEWAVE_HOME: "relative-home" }, cwd: project },
    );
    assert.equal(
      JSON.parse(relativeInit.stdout).mcpServers.litewave.env.LITEWAVE_HOME,
      path.join(project, "relative-home"),
    );
  } finally {
    if (previousHome === undefined) delete process.env.LITEWAVE_HOME;
    else process.env.LITEWAVE_HOME = previousHome;
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("init without --app and without a runtime names the flag", async () => {
  const root = await mkdtemp("/tmp/lw-i-");
  const project = await realpath(root);
  const env = { ...process.env, LITEWAVE_HOME: path.join(root, "s") };
  try {
    await assert.rejects(
      run(process.execPath, [cli, "init", "--project", project], { env }),
      (error: { stderr: string }) => {
        const result = JSON.parse(error.stderr);
        assert.equal(result.error.code, "invalid_request");
        assert.match(result.error.message, /--app/);
        assert.match(result.error.message, /no .*runtime/i);
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a nonexistent --project is an invalid_request for init and status", async () => {
  const root = await mkdtemp("/tmp/lw-n-");
  const env = { ...process.env, LITEWAVE_HOME: path.join(root, "s") };
  const missing = "/nonexistent/litewave/project";
  try {
    for (const args of [
      ["init", "--app", "http://localhost:4000"],
      ["status"],
    ]) {
      await assert.rejects(
        run(process.execPath, [cli, ...args, "--project", missing], { env }),
        (error: { code: number; stderr: string }) => {
          assert.equal(error.code, 1);
          const result = JSON.parse(error.stderr);
          assert.equal(result.error.code, "invalid_request");
          assert.match(result.error.message, /does not exist/);
          return true;
        },
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("browser install resolves the pinned Playwright CLI without running it", async () => {
  const cliPath = playwrightCli();
  assert.match(cliPath, /node_modules[\\/]playwright[\\/]cli\.js$/);
  await access(cliPath);
});
