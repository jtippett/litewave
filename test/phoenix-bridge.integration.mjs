import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { callPhoenix, resolveRuntime } from "../dist/src/phoenix.js";
import { atomicJson, projectKey } from "../dist/src/storage.js";
import { mcp } from "../dist/src/mcp.js";

const transportKind = process.env.LITEWAVE_FIXTURE_TRANSPORT ?? "endpoint";
const project = process.env.LITEWAVE_FIXTURE_PROJECT;
const registration =
  transportKind === "endpoint"
    ? {
        version: 1,
        id: "endpoint-fixture",
        project,
        app: process.env.LITEWAVE_FIXTURE_ORIGIN,
        directory: process.env.LITEWAVE_FIXTURE_DIRECTORY,
        token: "unused-browser-token",
        socket: path.join(
          process.env.LITEWAVE_FIXTURE_DIRECTORY,
          "absent-browser.sock",
        ),
        origins: [],
        uploadRoots: [],
      }
    : null;

if (process.argv.includes("--mcp-server")) {
  await mcp({ project, registration });
} else {
  if (transportKind === "endpoint") {
    await atomicJson(path.join(registration.directory, "phoenix.json"), {
      version: 1,
      endpoint: registration.app + "/litewave/runtime",
      token_file: process.env.LITEWAVE_FIXTURE_TOKEN_FILE,
      project_id: projectKey(project),
    });
  }
  const target = await resolveRuntime(project);
  assert.equal(target.kind, transportKind);
  const health = await callPhoenix(project, "phoenix_health");
  assert.equal(health.project_id, projectKey(project), JSON.stringify(health));
  assert.equal(health.transport, transportKind, JSON.stringify(health));
  assert.equal(health.sql_mode, "disabled");
  assert.ok(health.capabilities.includes("project_eval"));
  for (let attempt = 0; attempt < 3; attempt++) {
    const client = new Client({
      name: "litewave-runtime-test",
      version: "1.0.0",
    });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(import.meta.url), "--mcp-server"],
      env: process.env,
    });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      for (const name of [
        "browser",
        "get_docs",
        "get_source_location",
        "get_logs",
        "project_eval",
        "execute_sql_query",
        "phoenix_health",
        "runtime_action_status",
      ])
        assert.ok(
          listed.tools.some((t) => t.name === name),
          name,
        );
      const liveHealth = await client.callTool({
        name: "phoenix_health",
        arguments: {},
      });
      assert.equal(liveHealth.structuredContent.runtime_id, health.runtime_id);
      const evaluated = await client.callTool({
        name: "project_eval",
        arguments: {
          code: 'IO.puts("bridge output"); Enum.sum(arguments)',
          arguments: [10, 20],
          runtime_id: health.runtime_id,
          request_id: `bridge-eval-${transportKind}`,
        },
      });
      assert.equal(
        evaluated.structuredContent.result.text,
        "30",
        JSON.stringify(evaluated),
      );
      assert.equal(evaluated.structuredContent.stdout, "bridge output\n");
      const docs = await client.callTool({
        name: "get_docs",
        arguments: { reference: "String.split/2" },
      });
      assert.equal(docs.isError, false, JSON.stringify(docs));
      const source = await client.callTool({
        name: "get_source_location",
        arguments: { reference: "Litewave.TestDocumented.greet/1" },
      });
      assert.match(source.structuredContent.result.path, /documented\.ex$/);
      const old = await client.callTool({
        name: "project_eval",
        arguments: {
          code: 'raise "must not run"',
          runtime_id: "old-runtime",
          request_id: "stale",
        },
      });
      assert.equal(old.structuredContent.error.code, "runtime_changed");
      const browser = await client.callTool({
        name: "browser",
        arguments: { method: "status", requestId: "browser-down" },
      });
      assert.equal(browser.isError, true);
      if (transportKind === "socket")
        assert.equal(browser.structuredContent.error.code, "not_registered");
      assert.equal(
        (await client.callTool({ name: "phoenix_health", arguments: {} }))
          .isError,
        false,
      );
    } finally {
      await client.close();
    }
  }
  console.log(`Phoenix MCP bridge passed over ${transportKind}`);
}
