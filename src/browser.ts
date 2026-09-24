import { randomUUID, createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, open, rename, stat } from "node:fs/promises";
import path from "node:path";
import {
  chromium,
  errors,
  type BrowserContext,
  type Download,
  type Locator,
  type Page,
} from "playwright";
import {
  selectProfile,
  QUALIFIED_BROWSER_VERSION,
  type BrowserOpenOptions,
} from "./profile.js";
import {
  assertProfileAvailable,
  profileLockOwner,
} from "./profile-ownership.js";
import { loadArtifacts, type Artifact } from "./artifacts.js";
import { Journal, type Action } from "./journal.js";
import {
  AccessError,
  failure,
  mutationMethods,
  VERSION,
  type Envelope,
  type Operation,
  type Target,
} from "./protocol.js";
import {
  allowedUpload,
  uploadPolicy,
  atomicJson,
  exists,
  privateDir,
  type Registration,
} from "./storage.js";

type Tab = {
  id: string;
  page: Page;
  revision: number;
  busy: boolean;
  actionId: string | null;
};
export class BrowserWorker {
  readonly sessionId = randomUUID();
  readonly startedAt = new Date().toISOString();
  readonly tabs = new Map<string, Tab>();
  readonly downloads = new Map<string, Artifact>();
  readonly pendingDownloads = new Set<Promise<void>>();
  readonly journal: Journal;
  context: BrowserContext | null = null;
  state = "starting";
  profile: string | null = null;
  private lockOwner: string | null = null;
  private closedRecord: Promise<void> = Promise.resolve();
  private closeRecordFailed = false;
  private shutdown: Promise<void> | null = null;
  shutdownDurationMs: number | null = null;
  constructor(readonly registration: Registration) {
    this.journal = new Journal(path.join(registration.directory, "journal"));
  }
  async open(headless = false, options: BrowserOpenOptions = {}) {
    const selected = await selectProfile(this.registration, options);
    const profile = selected.directory;
    this.profile = profile;
    await privateDir(profile);
    await assertProfileAvailable(this.registration, profile);
    try {
      this.context = await chromium.launchPersistentContext(profile, {
        channel: "chromium",
        headless,
        acceptDownloads: true,
        viewport: { width: 1280, height: 800 },
        serviceWorkers: "block",
      });
    } catch (error) {
      if (/ProcessSingleton|SingletonLock|already in use/i.test(String(error)))
        throw new AccessError(
          "profile_in_use",
          "The dedicated profile has another owner. Close it manually or use a new registration.",
          "doctor",
        );
      throw new AccessError(
        "browser_closed",
        "Chromium could not start. Run npm run browser:install and inspect the local environment.",
        "doctor",
      );
    }
    this.lockOwner = await profileLockOwner(profile);
    this.context.on("close", () => {
      this.state = "closed";
      this.closedRecord = this.recordSession().catch(() => {
        this.closeRecordFailed = true;
      });
    });
    // Recovery may rewrite interrupted intent; only the verified profile owner may do it.
    try {
      if (this.context.browser()?.version() !== QUALIFIED_BROWSER_VERSION)
        throw new AccessError(
          "browser_version_mismatch",
          "The installed browser differs from Litewave's qualified version. Run npm ci and npm run browser:install.",
          "doctor",
        );
      if (options.storageState)
        await this.context.setStorageState(options.storageState);
      await this.journal.load();
      for (const artifact of await loadArtifacts(
        path.join(this.registration.directory, "artifacts"),
      ))
        this.downloads.set(artifact.id, artifact);
    } catch (error) {
      await this.close();
      throw error;
    }
    this.context.setDefaultTimeout(5000);
    this.context.setDefaultNavigationTimeout(30_000);
    await this.context.route("**/*", async (route) => {
      const req = route.request();
      if (req.isNavigationRequest() && !this.allowedOrigin(req.url()))
        await route.abort("blockedbyclient");
      else await route.continue();
    });
    this.context.on("page", (page) => this.addTab(page));
    for (const page of this.context.pages()) this.addTab(page);
    this.state = "ready";
    await this.recordSession();
    if (options.freshProfile)
      await atomicJson(
        path.join(this.registration.directory, "browser-profile.json"),
        { name: selected.name },
      );
  }
  private async recordSession() {
    await atomicJson(path.join(this.registration.directory, "session.json"), {
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      projectId: this.registration.id,
      browserVersion: this.context?.browser()?.version(),
      profile: this.profile,
      lockOwner: this.lockOwner,
      state: this.state,
      shutdownDurationMs: this.shutdownDurationMs,
    });
  }
  async close() {
    if (!this.context) return;
    this.shutdown ??= (async () => {
      const started = performance.now();
      if (this.state !== "closed") this.state = "closing";
      // Playwright bounds termination of the browser process it launched. Wait
      // for that termination and the durable close record before allowing reuse.
      await this.context!.close();
      this.state = "closed";
      await this.closedRecord;
      this.shutdownDurationMs = Math.round(performance.now() - started);
      if (this.closeRecordFailed)
        throw new AccessError(
          "storage_failure",
          "The browser closed, but its ownership record could not be saved. Inspect storage before reopening.",
          "doctor",
        );
      await this.recordSession();
    })();
    await this.shutdown;
  }
  allowedOrigin(url: string) {
    return this.registration.origins.includes(new URL(url).origin);
  }
  addTab(page: Page) {
    if ([...this.tabs.values()].some((t) => t.page === page)) return;
    const tab: Tab = {
      id: randomUUID(),
      page,
      revision: 0,
      busy: false,
      actionId: null,
    };
    this.tabs.set(tab.id, tab);
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) tab.revision++;
    });
    page.on("download", (download) => {
      const pending = this.saveDownload(tab, download);
      this.pendingDownloads.add(pending);
      void pending
        .finally(() => this.pendingDownloads.delete(pending))
        .catch(() => undefined);
    });
    // Leave confirmations to the user; ordinary tools must never accept one implicitly.
    page.on("dialog", () => undefined);
  }
  tab(id?: string) {
    if (!id)
      throw new AccessError(
        "tab_required",
        "Choose an explicit tabId from tabs.",
        "tabs",
      );
    const tab = this.tabs.get(id);
    if (this.state !== "ready" || !tab || tab.page.isClosed())
      throw new AccessError(
        "browser_closed",
        "The browser or tab is closing, closed, or outside this session.",
        "tabs",
      );
    return tab;
  }
  locate(tab: Tab, target?: Target): Locator {
    if (!target)
      throw new AccessError("invalid_request", "A target is required.");
    if (target.kind === "role")
      return tab.page.getByRole(
        target.role as Parameters<Page["getByRole"]>[0],
        { name: target.name, exact: true },
      );
    if (target.kind === "testId") return tab.page.getByTestId(target.value);
    return tab.page.locator(target.value);
  }
  async unique(tab: Tab, target?: Target) {
    const locator = this.locate(tab, target);
    await locator
      .first()
      .waitFor({ state: "attached", timeout: 5000 })
      .catch(() => {
        throw new AccessError(
          "target_not_found",
          "No target appeared within five seconds.",
          "snapshot",
        );
      });
    const count = await locator.count();
    if (count !== 1)
      throw new AccessError(
        "target_ambiguous",
        `${count} elements match; refine the locator.`,
        "snapshot",
      );
    return locator;
  }
  async saveDownload(tab: Tab, download: Download) {
    const id = randomUUID();
    const artifact: Artifact = {
      id,
      tabId: tab.id,
      actionId: tab.actionId,
      status: "saving",
      suggestedFilename: download.suggestedFilename().slice(0, 200),
      path: null,
      size: null,
      sha256: null,
      error: null,
      failureReason: null,
      createdAt: new Date().toISOString(),
    };
    this.downloads.set(id, artifact);
    const directory = path.join(this.registration.directory, "artifacts", id);
    let stage = "preparing local storage";
    let browserFailure: string | null = null;
    try {
      await privateDir(path.join(this.registration.directory, "artifacts"));
      await privateDir(directory);
      await atomicJson(path.join(directory, "manifest.json"), artifact);
      const name =
        artifact.suggestedFilename
          .replace(/[^a-zA-Z0-9._-]/g, "_")
          .replace(/^\.+/, "")
          .slice(0, 120) || "download";
      const partial = path.join(directory, ".download.partial");
      stage = "receiving the browser download";
      await download.saveAs(partial);
      browserFailure = await download.failure();
      if (browserFailure) throw new Error("Browser reported download failure.");
      stage = "verifying and retaining the downloaded file";
      const info = await stat(partial);
      const digest = createHash("sha256");
      for await (const chunk of createReadStream(partial)) digest.update(chunk);
      await chmod(partial, 0o600);
      const fd = await open(partial, "r");
      try {
        await fd.sync();
      } finally {
        await fd.close();
      }
      const final = path.join(directory, name);
      await rename(partial, final);
      const completed = {
        ...artifact,
        status: "complete" as const,
        path: final,
        size: info.size,
        sha256: digest.digest("hex"),
      };
      await atomicJson(path.join(directory, "manifest.json"), {
        ...completed,
        projectId: this.registration.id,
        sessionId: this.sessionId,
        browserVersion: this.context?.browser()?.version(),
      });
      Object.assign(artifact, completed);
    } catch (error) {
      // Playwright exception messages can contain page URLs or action values.
      // Retain the failure stage and safe native error code without leaking them.
      const code = (error as NodeJS.ErrnoException)?.code;
      browserFailure ??= String(error).match(/net::ERR_[A-Z_]+/)?.[0] ?? null;
      const reason =
        browserFailure && /^(canceled|net::ERR_[A-Z_]+)$/.test(browserFailure)
          ? browserFailure
          : null;
      Object.assign(artifact, {
        status: "failed",
        error:
          this.state === "closed" ||
          this.context?.browser()?.isConnected() === false ||
          /Target .* has been closed/.test(String(error))
            ? "browser_closed"
            : "download_failed",
        failureReason: `Failed while ${stage}${reason ? `: ${reason}` : typeof code === "string" && /^[A-Z_]+$/.test(code) ? `: ${code}` : ""}.`,
        path: null,
      });
      await atomicJson(path.join(directory, "manifest.json"), artifact).catch(
        () => undefined,
      );
    }
  }
  async execute(op: Operation): Promise<Envelope> {
    const start = performance.now();
    let tab: Tab | undefined;
    let action: Action | undefined;
    let dispatchStarted = false;
    let dispatched = false;
    let ownsLease = false;
    const response: Envelope = {
      protocolVersion: VERSION,
      requestId: op.requestId,
      sessionId: this.sessionId,
      tabId: op.tabId ?? null,
      documentRevision: null,
      durationMs: 0,
      status: "ok",
      result: null,
      warnings: [],
      error: null,
    };
    const finish = () => {
      response.durationMs = Math.round(performance.now() - start);
      response.documentRevision = tab?.revision ?? null;
      return response;
    };
    const mutating = mutationMethods.has(op.method);
    try {
      if (mutating) {
        const accepted = await this.journal.accept(op);
        action = accepted.action;
        if (accepted.duplicate) {
          if (action.response) return action.response;
          response.status = action.state;
          response.result = action;
          return finish();
        }
      }
      if (op.method === "action_status") {
        if (!op.actionId)
          throw new AccessError("invalid_request", "actionId is required.");
        response.result = this.journal.actions.get(op.actionId) ?? null;
        return finish();
      }
      if (op.method === "status") {
        response.result = {
          state: this.state,
          sessionId: this.sessionId,
          workerPid: process.pid,
          startedAt: this.startedAt,
          projectId: this.registration.id,
          app: this.registration.app,
          uploads: uploadPolicy(this.registration),
          applicationLogin: "unknown",
          phoenixAdapter: (await exists(
            path.join(this.registration.directory, "phoenix.json"),
          ))
            ? "configured"
            : "not_configured",
          browserVersion: this.context?.browser()?.version(),
          profile: this.profile,
          shutdownDurationMs: this.shutdownDurationMs,
          capabilities: [
            "tabs",
            "snapshot",
            "screenshot",
            "navigate",
            "click",
            "fill",
            "select",
            "check",
            "keypress",
            "hover",
            "upload",
            "wait",
            "downloads",
            "action_status",
          ],
          unsupported: [
            "snapshot_refs",
            "frames",
            "evaluation",
            "trace",
            "dialog_actions",
            "cancellation",
            "tab_create_close",
            "phoenix",
          ],
        };
        return finish();
      }
      if (op.method === "tabs") {
        response.result = [...this.tabs.values()].map((t) => ({
          id: t.id,
          url: safeUrl(t.page.url()),
          revision: t.revision,
          closed: t.page.isClosed(),
        }));
        return finish();
      }
      if (op.method === "downloads") {
        response.result = [...this.downloads.values()];
        return finish();
      }
      if (op.method === "stop") {
        if (
          [...this.tabs.values()].some((t) => t.busy) ||
          this.pendingDownloads.size
        )
          throw new AccessError(
            "tab_busy",
            "An action or download is in progress. Wait before stopping.",
            "downloads",
          );
        await this.close();
        response.result = {
          state: this.state,
          shutdownDurationMs: this.shutdownDurationMs,
        };
        if ((this.shutdownDurationMs ?? 0) >= 10_000)
          response.warnings.push(
            "Chromium shutdown was slow. Playwright waited for its owned process to terminate; the saved ownership record allows a verified subsequent open.",
          );
        return finish();
      }
      tab = this.tab(op.tabId);
      if (op.revision !== undefined && op.revision !== tab.revision)
        throw new AccessError(
          "stale_snapshot",
          "The document changed; obtain a new snapshot.",
          "snapshot",
        );
      if (op.method !== "navigate" && !this.allowedOrigin(tab.page.url()))
        throw new AccessError(
          "permission_denied",
          "This tab is outside the registered origins.",
          "navigate",
        );
      if (mutating && tab.busy)
        throw new AccessError(
          "tab_busy",
          "Another client has an action in progress on this tab.",
          "action_status",
        );
      if (mutating) {
        tab.busy = true;
        ownsLease = true;
      }
      if (op.method === "snapshot") {
        const text = await (
          op.target
            ? await this.unique(tab, op.target)
            : tab.page.locator("body")
        ).ariaSnapshot();
        response.result = {
          text: text.slice(0, 32_000),
          truncated: text.length > 32_000,
        };
      } else if (op.method === "screenshot") {
        const directory = path.join(this.registration.directory, "screenshots");
        await privateDir(directory);
        const file = path.join(directory, `${randomUUID()}.png`);
        const options = {
          path: file,
          mask: [tab.page.locator("input[type=password]")],
          scale: "css" as const,
        };
        const bytes = op.target
          ? await (await this.unique(tab, op.target)).screenshot(options)
          : await tab.page.screenshot({
              ...options,
              fullPage: op.fullPage ?? false,
            });
        await chmod(file, 0o600);
        response.result = {
          path: file,
          viewport: tab.page.viewportSize(),
          imageWidth: bytes.readUInt32BE(16),
          imageHeight: bytes.readUInt32BE(20),
          scale: "css",
          revision: tab.revision,
        };
        await atomicJson(`${file}.json`, {
          ...(response.result as object),
          sessionId: this.sessionId,
          projectId: this.registration.id,
          createdAt: new Date().toISOString(),
        });
      } else if (op.method === "wait") {
        await this.locate(tab, op.target).waitFor({
          state: op.state ?? "visible",
          timeout: op.timeoutMs ?? 10_000,
        });
        response.result = { observed: true };
      } else {
        let target: Locator | undefined;
        let uploads: Awaited<ReturnType<typeof allowedUpload>>[] | undefined;
        if (op.method === "navigate") {
          if (!op.url || !this.allowedOrigin(op.url))
            throw new AccessError(
              "permission_denied",
              "Navigation must use a configured origin.",
            );
        } else target = await this.unique(tab, op.target);
        if (["fill", "keypress"].includes(op.method) && op.value === undefined)
          throw new AccessError("invalid_request", "value is required.");
        if (op.method === "select" && !op.values)
          throw new AccessError("invalid_request", "values is required.");
        if (op.method === "check" && op.checked === undefined)
          throw new AccessError("invalid_request", "checked is required.");
        if (op.method === "upload") {
          if (!op.paths)
            throw new AccessError(
              "invalid_request",
              "paths is required; use [] to clear a file input.",
            );
          uploads = await Promise.all(
            op.paths.map((p) =>
              allowedUpload(p, this.registration.uploadRoots),
            ),
          );
        }
        if (!action)
          throw new AccessError(
            "unsupported_capability",
            "Operation is not supported.",
          );
        await this.journal.transition(action, "dispatching");
        dispatchStarted = true;
        tab.actionId = op.requestId;
        switch (op.method) {
          case "navigate":
            await tab.page.goto(op.url!, {
              waitUntil: "domcontentloaded",
              timeout: op.timeoutMs ?? 30_000,
            });
            break;
          case "click":
            await target!.click();
            break;
          case "fill":
            await target!.fill(op.value!);
            break;
          case "select":
            await target!.selectOption(op.values!);
            break;
          case "check":
            await target!.setChecked(op.checked!);
            break;
          case "keypress":
            await target!.press(op.value!);
            break;
          case "hover":
            await target!.hover();
            break;
          case "upload":
            await target!.setInputFiles(uploads!.map((f) => f.path));
            break;
        }
        dispatched = true;
        await this.journal.transition(action, "dispatched");
        if (op.postcondition)
          await this.locate(tab, op.postcondition.target).waitFor({
            state: op.postcondition.state,
            timeout: op.timeoutMs ?? 10_000,
          });
        response.status = op.postcondition ? "postcondition_met" : "dispatched";
        response.result = uploads
          ? {
              selectedFiles: uploads.map(({ name, size }) => ({ name, size })),
              serverImport: "not_observed",
            }
          : {
              dispatched: true,
              postconditionObserved: Boolean(op.postcondition),
            };
        await this.journal.transition(action, response.status, finish());
      }
      return finish();
    } catch (error) {
      const classified =
        this.state === "closed"
          ? new AccessError(
              "browser_closed",
              "The browser closed. Inspect action_status and downloads before opening a replacement session.",
              "doctor",
            )
          : error instanceof errors.TimeoutError
            ? new AccessError(
                "timeout",
                "The requested browser observation timed out.",
                "snapshot",
              )
            : error;
      response.error = failure(op.requestId, classified).error;
      if (dispatchStarted) {
        response.status = "outcome_unknown";
        response.error = {
          code:
            dispatched &&
            op.postcondition &&
            error instanceof errors.TimeoutError
              ? "postcondition_timeout"
              : "outcome_unknown",
          message: dispatched
            ? "Dispatch completed, but the requested observation was not confirmed. Do not replay automatically."
            : "Dispatch may have occurred. Do not replay automatically.",
          dispatchOccurred: dispatched ? true : "unknown",
          nextOperation: "action_status",
        };
      } else response.status = action ? "rejected_before_dispatch" : "error";
      if (action)
        await this.journal
          .transition(action, response.status as Action["state"], finish())
          .catch(() => {
            response.warnings.push(
              "Journal storage failed. Further mutations are disabled; this observation could not be persisted.",
            );
          });
      return finish();
    } finally {
      // Only release the lease acquired by this request; a rejected second client cannot unlock it.
      if (tab && ownsLease) {
        tab.busy = false;
        tab.actionId = null;
      }
    }
  }
}
function safeUrl(value: string) {
  const url = new URL(value);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.href;
}
