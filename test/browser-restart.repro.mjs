// Standalone diagnostic: exits nonzero when the native crash reproduces.
// Uses no Litewave worker, customer profile, login, or customer artifact.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
process.umask(0o077);
const root = await mkdtemp("/private/tmp/lw-lifecycle-");
const bytes = Buffer.from(
  "Independent persistent-download regression fixture.\n",
);
const server = createServer((req, res) => {
  if (req.url === "/file") {
    res.writeHead(200, {
      "content-type": "text/plain",
      "content-disposition": 'attachment; filename="fixture.txt"',
      "content-length": bytes.length,
    });
    res.end(bytes);
  } else {
    res.writeHead(200, { "content-type": "text/html" });
    res.end('<a href="/file">Download</a>');
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
try {
  for (const headless of [true, false])
    for (let round = 1; round <= 3; round++) {
      let context,
        closed = false;
      try {
        context = await chromium.launchPersistentContext(
          root + "/profile-" + headless,
          {
            channel: process.env.LITEWAVE_REPRO_CHANNEL || "chromium",
            headless,
            acceptDownloads: true,
            serviceWorkers: "block",
          },
        );
        console.log(
          JSON.stringify({
            headless,
            round,
            version: context.browser()?.version(),
          }),
        );
        context.on("close", () => {
          closed = true;
        });
        const page = context.pages()[0];
        await page.goto("http://127.0.0.1:" + server.address().port);
        for (let attempt = 1; attempt <= 2; attempt++) {
          const [download] = await Promise.all([
            page.waitForEvent("download", { timeout: 10000 }),
            page.getByRole("link", { name: "Download" }).click(),
          ]);
          await download.saveAs(root + "/result.txt");
          assert.deepEqual(await readFile(root + "/result.txt"), bytes);
          await delay(1500);
          assert.equal(closed, false, "Browser closed after download");
          console.log(
            JSON.stringify({ headless, round, attempt, result: "pass" }),
          );
        }
      } catch (error) {
        console.log(
          JSON.stringify({
            headless,
            round,
            result: "failed",
            closed,
            error: String(error).slice(0, 600),
          }),
        );
        process.exitCode = 1;
        break;
      } finally {
        await context?.close().catch(() => {});
      }
    }
} finally {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await rm(root, { recursive: true, force: true });
}
