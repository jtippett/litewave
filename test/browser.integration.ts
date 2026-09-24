import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { connect } from "node:net";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { register } from "../src/storage.js";
import { openBrowser } from "../src/supervisor.js";
import { rpc } from "../src/transport.js";
import type { Envelope, Operation } from "../src/protocol.js";
import { BrowserWorker } from "../src/browser.js";

test(
  "persistent worker: 20 MCP restarts, real upload, retained download, screenshot, lease and lost response",
  { timeout: 120_000 },
  async () => {
    const root = await mkdtemp("/tmp/lw-browser-");
    const previous = process.env.LITEWAVE_HOME;
    process.env.LITEWAVE_HOME = path.join(root, "state");
    let submissions = 0;
    const fixture = createServer((req, res) => {
      if (req.url === "/submit") {
        submissions++;
        res.end("ok");
        return;
      }
      if (req.url === "/download") {
        res.writeHead(200, {
          "Content-Type": "application/epub+zip",
          "Content-Disposition": 'attachment; filename="../result.epub"',
        });
        res.end("deterministic download fixture; not a real EPUB");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!doctype html><html><body><h1>Fixture</h1>${req.headers.cookie?.includes("fixture_session=persisted") ? "<h2>Signed in</h2>" : ""}
      <label>PDF<input type="file" data-testid="upload" onchange="document.querySelector('#selected').textContent=this.files[0]?.name||''"></label><p id="selected"></p>
      <label>Name<input aria-label="Name"></label><label>Secret<input type="password" value="private"></label>
      <button onclick="fetch('/submit',{method:'POST'}).then(()=>document.querySelector('#result').textContent='Submitted')">Submit</button><p id="result"></p>
      <button onclick="setTimeout(()=>document.querySelector('#later').textContent='Done',700)">Later</button><p id="later"></p>
      <button>Duplicate</button><button>Duplicate</button><a href="/download" download>Download</a>
      <script>document.cookie='fixture_session=persisted;path=/';</script></body></html>`);
    });
    await new Promise<void>((resolve) =>
      fixture.listen(0, "127.0.0.1", resolve),
    );
    const address = fixture.address() as { port: number };
    const project = path.join(root, "project");
    await mkdir(project);
    const source = path.join(project, "sample.pdf");
    await writeFile(source, "%PDF-1.4 fixture");
    const r = await register(project, `http://127.0.0.1:${address.port}`, [
      project,
    ]);
    let stopped = false;
    const call = (op: Omit<Operation, "requestId"> & { requestId?: string }) =>
      rpc(r, { requestId: randomUUID(), ...op });
    try {
      const opened = await openBrowser(
        r,
        process.env.LITEWAVE_TEST_HEADED !== "1",
      );
      assert.equal(opened.status, "ok");
      const sessionId = opened.sessionId;
      const tabs = await call({ method: "tabs" });
      const tabId = (tabs.result as { id: string }[])[0]!.id;
      assert.equal(
        (await call({ method: "navigate", tabId, url: r.app })).status,
        "dispatched",
      );
      const otherOwner = new BrowserWorker(r);
      try {
        await assert.rejects(
          otherOwner.open(process.env.LITEWAVE_TEST_HEADED !== "1"),
          { code: "profile_in_use" },
        );
      } finally {
        await otherOwner.close();
      }
      assert.equal((await call({ method: "status" })).sessionId, sessionId);
      // Real SDK transports are started and detached, not simulated status calls.
      for (let i = 0; i < 20; i++) {
        const client = new Client({
          name: "litewave-acceptance",
          version: "1.0.0",
        });
        const transport = new StdioClientTransport({
          command: process.execPath,
          args: [
            fileURLToPath(new URL("../src/cli.js", import.meta.url)),
            "mcp",
            "--project",
            project,
          ],
          env: {
            ...Object.fromEntries(
              Object.entries(process.env).filter(
                (e): e is [string, string] => e[1] !== undefined,
              ),
            ),
            LITEWAVE_HOME: process.env.LITEWAVE_HOME!,
          },
        });
        await client.connect(transport);
        const tools = await client.listTools();
        assert.equal(tools.tools[0]?.name, "browser");
        const result = await client.callTool({
          name: "browser",
          arguments: { method: "status", requestId: `restart-${i}` },
        });
        assert.equal(
          (result.structuredContent as Envelope).sessionId,
          sessionId,
        );
        const policy = (
          (result.structuredContent as Envelope).result as {
            uploads: { roots: string[]; state: string };
          }
        ).uploads;
        assert.deepEqual(policy.roots, r.uploadRoots);
        assert.equal(policy.state, "configured");
        await client.close();
      }
      await call({ method: "navigate", tabId, url: r.app });
      const snapshot = await call({ method: "snapshot", tabId });
      assert.match((snapshot.result as { text: string }).text, /Fixture/);
      assert.match((snapshot.result as { text: string }).text, /Signed in/);
      const revision = snapshot.documentRevision!;
      const selected = await call({
        method: "upload",
        tabId,
        target: { kind: "testId", value: "upload" },
        paths: [source],
      });
      assert.equal(selected.status, "dispatched");
      assert.deepEqual(
        (selected.result as { selectedFiles: unknown }).selectedFiles,
        [{ name: "sample.pdf", size: 16 }],
      );
      const selectedSnapshot = await call({ method: "snapshot", tabId });
      assert.match(
        (selectedSnapshot.result as { text: string }).text,
        /sample.pdf/,
      );
      const ambiguous = await call({
        method: "click",
        tabId,
        target: { kind: "role", role: "button", name: "Duplicate" },
      });
      assert.equal(ambiguous.status, "rejected_before_dispatch");
      assert.equal(ambiguous.error?.code, "target_ambiguous");
      const screen = await call({ method: "screenshot", tabId });
      const image = screen.result as {
        path: string;
        imageWidth: number;
        imageHeight: number;
      };
      assert.equal(image.imageWidth, 1280);
      assert.equal(image.imageHeight, 800);
      assert.ok((await stat(image.path)).size > 1000);
      const lease = call({
        method: "click",
        requestId: "slow-action",
        tabId,
        target: { kind: "role", role: "button", name: "Later" },
        postcondition: {
          target: { kind: "css", value: '#later:has-text("Done")' },
          state: "visible",
        },
      });
      for (let i = 0; i < 50; i++) {
        const state = await call({
          method: "action_status",
          actionId: "slow-action",
        });
        if ((state.result as { state?: string } | null)?.state === "dispatched")
          break;
        await delay(10);
      }
      const busy = await call({
        method: "fill",
        tabId,
        target: { kind: "role", role: "textbox", name: "Name" },
        value: "No race",
      });
      assert.equal(busy.error?.code, "tab_busy");
      assert.equal((await lease).status, "postcondition_met");
      // Drop the transport immediately after writing a submit request. Reusing its ID must not submit twice.
      const submit: Operation = {
        method: "click",
        requestId: "lost-submit",
        tabId,
        target: { kind: "role", role: "button", name: "Submit" },
      };
      await new Promise<void>((resolve, reject) => {
        const socket = connect(r.socket, () =>
          socket.write(
            JSON.stringify({
              token: r.token,
              registrationId: r.id,
              operation: submit,
            }) + "\n",
            () => {
              socket.destroy();
              resolve();
            },
          ),
        );
        socket.on("error", reject);
      });
      for (let i = 0; i < 100 && submissions === 0; i++) await delay(20);
      assert.equal(submissions, 1);
      for (let i = 0; i < 100; i++) {
        const outcome = await call({
          method: "action_status",
          actionId: submit.requestId,
        });
        if ((outcome.result as { response?: Envelope })?.response) break;
        await delay(20);
      }
      assert.ok(
        ["dispatched", "outcome_unknown"].includes((await call(submit)).status),
      );
      assert.equal(submissions, 1);
      const downloadClick = await call({
        method: "click",
        tabId,
        target: { kind: "role", role: "link", name: "Download" },
      });
      assert.equal(
        downloadClick.status,
        "dispatched",
        JSON.stringify(downloadClick),
      );
      let downloads: { path: string; status: string; sha256: string }[] = [];
      for (let i = 0; i < 100; i++) {
        downloads = (await call({ method: "downloads" }))
          .result as typeof downloads;
        if (downloads[0]?.status === "complete") break;
        await delay(20);
      }
      assert.equal(downloads[0]?.status, "complete");
      assert.match(downloads[0]!.sha256, /^[a-f0-9]{64}$/);
      assert.ok(downloads[0]!.path.startsWith(r.directory));
      await call({ method: "navigate", tabId, url: r.app });
      const stale = await call({
        method: "click",
        tabId,
        revision,
        target: { kind: "role", role: "button", name: "Submit" },
      });
      assert.equal(stale.error?.code, "stale_snapshot");
      assert.equal(submissions, 1);
      const outside = await call({
        method: "navigate",
        tabId,
        url: "https://example.com",
      });
      assert.equal(outside.error?.code, "permission_denied");
      const invalidToken = await rpc(
        { ...r, token: "x".repeat(r.token.length) },
        { method: "status", requestId: "bad-token" },
      );
      assert.equal(invalidToken.error?.code, "permission_denied");
      assert.equal((await call({ method: "stop" })).status, "ok");
      stopped = true;
      assert.equal(
        await readFile(downloads[0]!.path, "utf8"),
        "deterministic download fixture; not a real EPUB",
      );
    } finally {
      if (!stopped) await call({ method: "stop" }).catch(() => undefined);
      fixture.closeAllConnections();
      await new Promise<void>((resolve) => fixture.close(() => resolve()));
      if (previous === undefined) delete process.env.LITEWAVE_HOME;
      else process.env.LITEWAVE_HOME = previous;
      await rm(root, { recursive: true, force: true });
    }
  },
);
