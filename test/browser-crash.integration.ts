import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { BrowserWorker } from "../src/browser.js";
import { register } from "../src/storage.js";
import { serve, rpc } from "../src/transport.js";
import { doctor } from "../src/supervisor.js";
import type { Operation } from "../src/protocol.js";

test(
  "a native browser crash interrupts a download but preserves completed artifacts and worker diagnostics",
  { timeout: 60_000 },
  async () => {
    const root = await mkdtemp("/tmp/lw-native-");
    const previous = process.env.LITEWAVE_HOME;
    process.env.LITEWAVE_HOME = path.join(root, "state");
    const fixture = createServer((req, res) => {
      if (req.url === "/empty") {
        res.writeHead(200, {
          "Content-Disposition": 'attachment; filename="empty.txt"',
          "Content-Length": "0",
        });
        res.end();
        return;
      }
      if (req.url === "/slow") {
        res.writeHead(200, {
          "Content-Disposition": 'attachment; filename="slow.bin"',
          "Content-Type": "application/octet-stream",
          "Content-Length": "10000000",
        });
        res.write(Buffer.alloc(10000, 7));
        return;
      }
      res.end('<a href="/empty">Empty</a><a href="/slow">Slow</a>');
    });
    await new Promise<void>((resolve) =>
      fixture.listen(0, "127.0.0.1", resolve),
    );
    let worker: BrowserWorker | undefined;
    let server: Awaited<ReturnType<typeof serve>> | undefined;
    try {
      const project = path.join(root, "project");
      await mkdir(project);
      const r = await register(
        project,
        `http://127.0.0.1:${(fixture.address() as { port: number }).port}`,
      );
      worker = new BrowserWorker(r);
      await worker.open(process.env.LITEWAVE_TEST_HEADED !== "1");
      const active = worker;
      server = await serve(r, (op) => active.execute(op));
      const tabId = [...worker.tabs.keys()][0]!;
      const call = (op: Omit<Operation, "requestId">) =>
        rpc(r, { requestId: randomUUID(), tabId, ...op });
      await call({ method: "navigate", url: r.app });
      await call({
        method: "click",
        target: { kind: "role", role: "link", name: "Empty" },
      });
      await Promise.all(worker.pendingDownloads);
      const completed = [...worker.downloads.values()][0]!;
      assert.equal(completed.status, "complete");
      assert.equal(completed.size, 0);
      await call({
        method: "click",
        target: { kind: "role", role: "link", name: "Slow" },
      });
      const deadline = Date.now() + 5000;
      while (worker.downloads.size < 2 && Date.now() < deadline)
        await delay(20);
      assert.equal(worker.downloads.size, 2);
      assert.equal((await call({ method: "stop" })).error?.code, "tab_busy");
      // Public CDP crash injection targets only this test's owned Chromium process.
      const cdp = await worker.context!.browser()!.newBrowserCDPSession();
      const browserClosed = worker.context!.waitForEvent("close", {
        timeout: 5000,
      });
      void cdp.send("Browser.crash").catch(() => undefined);
      await browserClosed;
      await Promise.all(worker.pendingDownloads);
      assert.equal(worker.state, "closed");
      const failed = [...worker.downloads.values()][1]!;
      assert.equal(failed.status, "failed");
      assert.equal(failed.error, "browser_closed");
      assert.match(failed.failureReason!, /receiving the browser download/);
      assert.equal(completed.status, "complete");
      assert.equal((await readFile(completed.path!)).length, 0);
      assert.match((await doctor(r)).remedy!, /browser closed/i);
      assert.equal((await call({ method: "stop" })).status, "ok");
      server = undefined;
      const replacement = new BrowserWorker(r);
      worker = replacement;
      await replacement.open(process.env.LITEWAVE_TEST_HEADED !== "1");
      const newTabId = [...replacement.tabs.keys()][0]!;
      await replacement.execute({
        method: "navigate",
        requestId: randomUUID(),
        tabId: newTabId,
        url: r.app,
      });
      await replacement.execute({
        method: "click",
        requestId: randomUUID(),
        tabId: newTabId,
        target: { kind: "role", role: "link", name: "Empty" },
      });
      await Promise.all(replacement.pendingDownloads);
      await delay(1500);
      assert.equal(replacement.state, "ready");
      assert.equal(
        [...replacement.downloads.values()].filter(
          (a) => a.status === "complete",
        ).length,
        2,
      );
      assert.equal(replacement.downloads.get(completed.id)?.status, "complete");
      assert.equal(
        replacement.downloads.get(failed.id)?.error,
        "browser_closed",
      );
    } finally {
      await worker?.close();
      if (server)
        await new Promise<void>((resolve) => server!.close(() => resolve()));
      fixture.closeAllConnections();
      await new Promise<void>((resolve) => fixture.close(() => resolve()));
      if (previous === undefined) delete process.env.LITEWAVE_HOME;
      else process.env.LITEWAVE_HOME = previous;
      await rm(root, { recursive: true, force: true });
    }
  },
);
