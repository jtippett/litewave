import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { callPhoenix } from "../dist/src/phoenix.js";
import { atomicJson } from "../dist/src/storage.js";
import { mcp } from "../dist/src/mcp.js";

const directory = process.env.LITEWAVE_FIXTURE_DIRECTORY;
const r = {
  version: 1,
  id: "http-fixture",
  project: process.env.LITEWAVE_FIXTURE_PROJECT,
  app: process.env.LITEWAVE_FIXTURE_ORIGIN,
  directory,
  token: "unused-browser-token",
  socket: path.join(directory, "absent-browser.sock"),
  origins: [],
  uploadRoots: [],
};
if (process.argv.includes("--mcp-server")) {
  await mcp(r);
} else {
  await atomicJson(path.join(directory, "phoenix.json"), {
    version: 1,
    endpoint: r.app + "/litewave/runtime",
    token_file: process.env.LITEWAVE_FIXTURE_TOKEN_FILE,
    project_id: r.id,
  });
  const health = await callPhoenix(r, "phoenix_health");
  assert.equal(health.project_id, r.id, JSON.stringify(health));
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
        assert.ok(listed.tools.some((t) => t.name === name));
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
          request_id: "bridge-eval",
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
      assert.equal(
        (await client.callTool({ name: "phoenix_health", arguments: {} }))
          .isError,
        false,
      );
    } finally {
      await client.close();
    }
  }
  console.log("Phoenix MCP bridge passed");
}
