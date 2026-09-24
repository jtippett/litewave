import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Artifact } from "../src/artifacts.js";
import { BrowserWorker } from "../src/browser.js";
import { register } from "../src/storage.js";
import { doctor, openBrowser } from "../src/supervisor.js";
import { serve, rpc } from "../src/transport.js";
import type { Operation } from "../src/protocol.js";

const headless = process.env.LITEWAVE_TEST_HEADED !== "1";
test(
  "download/restart lifecycle preserves login, artifacts and uncertain action identity",
  { timeout: 450_000 },
  async (t) => {
    const root = await mkdtemp("/tmp/lw-recovery-");
    const previous = process.env.LITEWAVE_HOME;
    process.env.LITEWAVE_HOME = path.join(root, "state");
    const bytes = Buffer.from(
      "A separate restart regression: small deterministic bytes.\n",
    );
    const digest = createHash("sha256").update(bytes).digest("hex");
    let submissions = 0;
    const fixture = createServer((req, res) => {
      if (req.url === "/submit") {
        submissions++;
        res.end("ok");
        return;
      }
      if (req.url === "/file") {
        res.writeHead(200, {
          "Content-Type": "text/plain",
          "Content-Disposition": 'attachment; filename="small.txt"',
          "Content-Length": bytes.length,
        });
        res.end(bytes);
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        `<h1>${req.headers.cookie?.includes("session=retained") ? "Signed in" : "Guest"}</h1><a href="/file">Download</a><button onclick="fetch('/submit',{method:'POST'})">Submit</button><script>document.cookie='session=retained;max-age=3600;path=/';</script>`,
      );
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
      const call = (
        op: Omit<Operation, "requestId"> & { requestId?: string },
      ) => rpc(r, { requestId: randomUUID(), ...op });
      const oldProfile = path.join(r.directory, "profile");
      await mkdir(oldProfile);
      await writeFile(path.join(oldProfile, "Last Version"), "153.0.8010.12");
      const stateFile = path.join(root, "auth.json");
      await writeFile(
        stateFile,
        JSON.stringify({
          cookies: [
            {
              name: "session",
              value: "retained",
              domain: "127.0.0.1",
              path: "/",
              expires: Math.floor(Date.now() / 1000) + 3600,
              httpOnly: true,
              secure: false,
              sameSite: "Lax",
            },
          ],
          origins: [],
        }),
        { mode: 0o600 },
      );
      const opened = await openBrowser(r, headless, {
        freshProfile: true,
        storageState: stateFile,
      });
      assert.equal(opened.status, "ok");
      assert.equal(
        (opened.result as { browserVersion: string }).browserVersion,
        "151.0.7922.34",
      );
      const importedTab = (
        (await call({ method: "tabs" })).result as { id: string }[]
      )[0]!.id;
      await call({ method: "navigate", tabId: importedTab, url: r.app });
      assert.match(
        JSON.stringify(
          (await call({ method: "snapshot", tabId: importedTab })).result,
        ),
        /Signed in/,
      );
      await assert.rejects(openBrowser(r, headless, { freshProfile: true }), {
        code: "needs_attention",
      });
      assert.equal((await call({ method: "stop" })).status, "ok");
      assert.equal(
        await readFile(path.join(oldProfile, "Last Version"), "utf8"),
        "153.0.8010.12",
      );
      let interrupted: Operation | undefined;
      let priorSession: string | undefined;
      for (let round = 0; round < 10; round++) {
        t.signal.throwIfAborted();
        worker = new BrowserWorker(r);
        await worker.open(headless);
        const current = worker;
        server = await serve(r, (op) => current.execute(op));
        assert.notEqual(worker.sessionId, priorSession);
        priorSession = worker.sessionId;
        const tabId = [...worker.tabs.keys()][0]!;
        assert.equal(
          (await call({ method: "navigate", tabId, url: r.app })).status,
          "dispatched",
        );
        if (round)
          assert.match(
            JSON.stringify((await call({ method: "snapshot", tabId })).result),
            /Signed in/,
          );
        assert.equal(
          ((await call({ method: "downloads" })).result as unknown[]).length,
          round * 2,
        );
        if (interrupted) {
          assert.equal((await call(interrupted)).status, "outcome_unknown");
          assert.equal(submissions, 1);
        }
        const timeout = await call({
          method: "wait",
          tabId,
          target: { kind: "css", value: "#absent" },
          timeoutMs: 30,
        });
        assert.equal(timeout.error?.code, "timeout");
        for (let attempt = 0; attempt < 2; attempt++) {
          assert.equal(
            (
              await call({
                method: "click",
                tabId,
                target: { kind: "role", role: "link", name: "Download" },
              })
            ).status,
            "dispatched",
          );
          const deadline = Date.now() + 10_000;
          while (
            Date.now() < deadline &&
            [...worker.downloads.values()].filter(
              (a) => a.status === "complete",
            ).length <
              round * 2 + attempt + 1
          )
            await delay(20);
          const artifact: Artifact = [...worker.downloads.values()].at(-1)!;
          assert.equal(artifact.status, "complete", JSON.stringify(artifact));
          assert.equal(artifact.sha256, digest);
          assert.deepEqual(await readFile(artifact.path!), bytes);
          await delay(1500, undefined, { signal: t.signal }); // Detect delayed native crashes after saveAs returns.
          assert.equal(worker.state, "ready");
        }
        if (round === 0) {
          interrupted = {
            method: "click",
            requestId: "interrupted-submit",
            tabId,
            target: { kind: "role", role: "button", name: "Submit" },
            postcondition: {
              target: { kind: "css", value: "#never" },
              state: "visible",
            },
          };
          const inFlight = call(interrupted);
          const deadline = Date.now() + 5000;
          while (submissions === 0 && Date.now() < deadline) await delay(10);
          assert.equal(submissions, 1);
          // Close our own browser while the observation is pending, independently of stop.
          await worker.close();
          const result = await inFlight;
          assert.equal(result.status, "outcome_unknown");
          assert.notEqual(result.error?.code, "postcondition_timeout");
          assert.match((await doctor(r)).remedy!, /browser closed/i);
          assert.equal(
            ((await call({ method: "downloads" })).result as unknown[]).length,
            2,
          );
        }
        const closeStarted = Date.now();
        const closed = new Promise<void>((resolve) =>
          server!.close(() => resolve()),
        );
        await worker.close();
        await closed;
        server = undefined;
        worker = undefined;
        assert.ok(
          Date.now() - closeStarted < 35_000,
          "Browser shutdown exceeded the bounded termination allowance.",
        );
        t.diagnostic(
          `round ${round + 1}: two downloads verified; shutdown ${Date.now() - closeStarted}ms`,
        );
      }
      assert.equal(submissions, 1);
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

test(
  "a startup profile conflict survives the worker handshake and stop leaves its owner alive",
  { timeout: 45_000 },
  async () => {
    const root = await mkdtemp("/tmp/lw-startup-");
    const previous = process.env.LITEWAVE_HOME;
    process.env.LITEWAVE_HOME = path.join(root, "state");
    let owner: BrowserWorker | undefined;
    let r: Awaited<ReturnType<typeof register>> | undefined;
    try {
      const project = path.join(root, "project");
      await mkdir(project);
      r = await register(project, "http://127.0.0.1:1");
      owner = new BrowserWorker(r);
      await owner.open(headless);
      await assert.rejects(openBrowser(r, headless), {
        code: "profile_in_use",
      });
      assert.match((await doctor(r)).remedy!, /locked|owner/);
      assert.equal(
        (await rpc(r, { method: "stop", requestId: "stop-failed-worker" }))
          .status,
        "ok",
      );
      assert.equal(owner.state, "ready");
    } finally {
      if (r)
        await rpc(r, { method: "stop", requestId: randomUUID() }, 1000).catch(
          () => undefined,
        );
      await owner?.close();
      if (previous === undefined) delete process.env.LITEWAVE_HOME;
      else process.env.LITEWAVE_HOME = previous;
      await rm(root, { recursive: true, force: true });
    }
  },
);
