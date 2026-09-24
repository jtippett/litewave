# Quality and Documentation Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Litewave npm package and the `litewave_phoenix` Hex package to a publishable quality bar: linted, documented, metadata complete, CI on the supported version matrix, and READMEs that install and explain the socket transport built in plan 1.

**Architecture:** Code follow-ups from the socket-transport reviews land first (Tasks 1–3) so the documentation written afterwards describes final behaviour. Tooling and metadata follow (Tasks 4–7). Documentation is rewritten last (Tasks 8–9). No behaviour of the runtime protocol changes; the only wire-visible change is that the Node bridge names the HTTP Plug transport `endpoint`, matching Elixir.

**Tech Stack:** TypeScript 7.0.2 (`tsc` native build), Node 24.21.0 dev pin, oxlint, prettier, `node --test`; Elixir 1.17–1.20 / OTP 27–29, ex_doc, credo, dialyxir, Bandit, Req (tests); GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-24-hex-npm-release-design.md`, section 6 (quality sweep). Deferred review findings and rulings: `docs/superpowers/plans/2026-09-24-socket-transport-followups.md`. Both travel with this plan; executors read all three.

## Global Constraints

- Elixir support is `~> 1.17`. CI tests Elixir 1.17 on OTP 27 and 1.20 on OTP 29. If 1.17 fails and the fix is not small, raise the requirement rather than claim untested support (spec 6.1).
- Repository home is `https://github.com/jtippett/litewave`. Maintainer: James Tippett (`@jtippett`). Vulnerability reports go through GitHub private vulnerability reporting at `https://github.com/jtippett/litewave/security/advisories/new` (plan 3 enables it; the documents name it now).
- Package names: npm `litewave`, Hex `litewave_phoenix`. Version strings stay `0.1.0-alpha.1` in this plan; plan 3 bumps to `0.1.0` and aligns `src/mcp.ts`.
- npm dependencies are exact (`.npmrc` has `save-exact=true`). Every new devDependency is pinned to the exact version named in its task.
- No `postinstall` script. Chromium is installed only by an explicit command.
- Read-write SQL: every document that mentions `allow_sql` says beside it that SQL is read-write and `allow_eval` is not a sandbox.
- `LITEWAVE_HOME` must be the same absolute path for the app and every CLI/MCP client of that project. Documents that mention `LITEWAVE_HOME` say so.
- Development gates: `npm run check` (prettier, lint, build, unit tests) at the root; `mix precommit` in `packages/phoenix` (compile with warnings as errors, format check, credo strict, dialyzer, tests). Both must pass at the end of every task. Elixir tests print `41 passed, 3 excluded` plus whatever a task adds; the 3 excluded are the `:postgres` cases.
- Work on branch `quality-sweep` in place (no worktree; see the followups file's first ruling).
- Commit with `git -c commit.gpgsign=false commit ...`; the repo has `commit.gpgsign=true` and no key is available to agents.
- Run every command from the repository root unless a step says `working-directory`. Shell state in this harness drifts into `packages/phoenix`; every `mix` command in this plan is written as `(cd packages/phoenix && mix ...)`.

## Decisions this plan makes beyond the spec

1. **oxlint instead of typescript-eslint (spec 6.2).** The repo builds with `typescript@7.0.2`, the native compiler. That package exposes no JavaScript compiler API (`require("typescript").createProgram` is `undefined`), and `typescript-eslint@8.70.1` declares `typescript: ">=4.8.4 <6.1.0"` and needs that API to parse. oxlint 1.85.0 lints TypeScript without the compiler API, runs its `typescript` plugin by default, and a trial run found 12 findings in `src/` and `test/`, all real. The `lint` script and `check` integration the spec asks for are unchanged in shape.
2. **Node engine range widens to `>=24.21.0`.** The current `<25` upper bound would refuse Node 26, which is the LTS line from October 2026 and the version this repo's suites already run on locally. The development pin (`.node-version`, `.nvmrc`) stays 24.21.0. CI runs Node 24.21.0 and 26.
3. **A `litewave browser install` command.** The spec keeps Chromium installation explicit, but the only explicit command today is the repo-local npm script `browser:install`, which a user of the published package does not have. The new command runs the pinned Playwright CLI's `install chromium`. Nothing runs automatically.
4. **Customer figures are dropped, not moved.** `docs/status.md` loses its dated narratives; the capabilities they established go into the CHANGELOGs as undated entries, and test counts, byte sizes, and customer test-run figures are removed everywhere public.
5. **ex_doc module groups:** Integration: `Litewave`; Configuration: `Litewave.Config`; Internal: `Litewave.Listener`, `Litewave.Paths`. Every other module keeps `@moduledoc false`.
6. **`docs/browser-crash-investigation.md` stays** (spec 6.3) but three sentences that name the customer and its artifact size are generalised.

## Review Focus

Behaviours the spec implies but no existing test pins. Each line names the task that adds its test.

1. `LITEWAVE_HOME=~/x` or a relative `LITEWAVE_HOME` resolves to the same absolute directory in Node and Elixir, otherwise the descriptor identity check fails permanently with a misleading "identity is invalid" error. → Task 2 (Node `home()` test) and Task 3 (Elixir `Paths.home/1` test).
2. `--project` naming a directory that does not exist returns a JSON `invalid_request` error, not a raw `ENOENT` stack trace. → Task 2.
3. A production host (`MIX_ENV=prod`) starts no runtime children at all, so a release can never publish a socket. → Task 3 (`Application.children/2`).
4. The npm tarball contains the CLI, the notices, and the architecture doc, and nothing under `test/`, `dist/test/`, `packages/`, or `local-feedback/`; installing on Node 26 is not refused by `engines`. → Task 6.
5. The Hex tarball includes `CHANGELOG.md`, both licenses and `NOTICE`, and `mix docs` builds with no warnings and the three module groups present. → Task 5.

---

### Task 1: Node lint with oxlint

**Files:**

- Create: `.oxlintrc.json`
- Modify: `package.json` (devDependencies, scripts), `package-lock.json`
- Modify: `src/artifacts.ts:84`, `src/journal.ts:23`, `src/worker.ts:12`, `src/storage.ts:8`, `src/http.ts:37`, `src/phoenix.ts` (two helper functions), `test/browser-recovery.integration.ts:188`, `test/browser.integration.ts:223`, `test/browser-crash.integration.ts:65,85,112`

**Interfaces:**

- Consumes: nothing.
- Produces: `npm run lint` (exit 0 on a clean tree) and `npm run check` = `format:check && lint && test`. Task 6 keeps these scripts; Task 7 relies on `npm run check` running lint in CI.

- [ ] **Step 1: Install oxlint and add the config**

```bash
npm install --save-dev --save-exact oxlint@1.85.0
```

Create `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "categories": {
    "correctness": "error",
    "suspicious": "error"
  },
  "ignorePatterns": ["dist", "node_modules", "packages", "local-feedback"]
}
```

In `package.json` `scripts`, add `"lint": "oxlint src test"` and change `check` to `"npm run format:check && npm run lint && npm test"`.

- [ ] **Step 2: Run lint and confirm the twelve known findings fail it**

Run: `npm run lint`
Expected: exit code 1 with 12 errors: `unicorn(no-array-sort)` ×2, `eslint(no-unused-vars)` ×2, `eslint(no-unmodified-loop-condition)` ×2, `unicorn(no-useless-spread)` ×3, `unicorn(no-useless-fallback-in-spread)` ×1, `unicorn(consistent-function-scoping)` ×2. If the count differs, oxlint's rule set has moved; fix whatever it reports by the same rules below and record the difference in the ledger.

- [ ] **Step 3: Fix each finding**

- `src/artifacts.ts:84` and `src/journal.ts:23`: both use the return value of `.sort(...)`. Replace `.sort(` with `.toSorted(` (ES2023 is the tsconfig target; Node 24 supports it).
- `src/worker.ts:12`: `const server = await serve(r, ...)` is never read. Drop the binding: `await serve(r, (op) => ...)`. Keep the call; it binds the socket before Chromium launches.
- `src/storage.ts:8`: remove `readFile` from the `node:fs/promises` import list.
- `src/http.ts:37`: replace `...(init.headers ?? {})` with `...init.headers`.
- `src/phoenix.ts`: move `const literal = (text: string) => JSON.stringify(text).replaceAll("#{", "\\#{");` out of `setupPhoenix` to module scope directly above the function, and move `const denied = () => new AccessError("permission_denied", "Runtime socket directory or socket is not private to this user.");` out of `assertPrivateSocket` to module scope directly above it. Bodies unchanged.
- `test/browser-crash.integration.ts:65,85,112`: `Promise.all([...x])` → `Promise.all(x)` (the spread copies an iterable that `Promise.all` already accepts).
- `test/browser-recovery.integration.ts:188` and `test/browser.integration.ts:223`: the loop condition reads `submissions`, a `let` incremented inside the fixture server's request handler, which the rule cannot see. Do not restructure the browser suites; add, on the line above each loop:

```ts
// oxlint-disable-next-line no-unmodified-loop-condition -- incremented by the fixture server's request handler
```

- [ ] **Step 4: Run the full gate**

Run: `npm run check`
Expected: prettier clean, `npm run lint` exit 0, build succeeds, `node --test` reports 13 pass / 0 fail. If Chromium is installed locally (`ls ~/Library/Caches/ms-playwright` shows `chromium-*`), also run `npm run test:browser` because two browser suites changed; expected all pass. If it is not installed, say so in the ledger; CI runs it.

- [ ] **Step 5: Commit**

```bash
git add .oxlintrc.json package.json package-lock.json src test
git -c commit.gpgsign=false commit -m "Lint TypeScript with oxlint and fix its findings"
```

---

### Task 2: Node bridge follow-ups from the socket-transport review

**Files:**

- Modify: `src/phoenix.ts` (`RuntimeTarget`, `resolveRuntime`, `resolveHttpTarget`, `callPhoenix`), `src/storage.ts` (`home`), `src/mcp.ts` (browser tool description and `not_registered` message), `src/cli.ts` (`browser install` command, HELP), `src/index.ts`
- Modify: `test/phoenix.test.ts`, `test/runtime-paths.test.ts`, `test/cli-runtime.test.ts`, `test/phoenix-bridge.integration.mjs`
- Modify: `packages/phoenix/test/http_test.exs:65` (fixture transport env value)

**Interfaces:**

- Consumes: `TransportError(code, message, sent)` from `src/http.ts`; `AccessError(code, message, next?)` from `src/protocol.ts`.
- Produces: `RuntimeTarget` kind union becomes `"socket" | "endpoint"` (was `"http"`); `resolveRuntime` rejects a missing project with `AccessError("invalid_request", ...)`; `home()` expands a leading `~`; `playwrightCli(): string` exported from `src/cli.ts`? No: exported from `src/supervisor.ts` so the CLI and tests share it; new CLI command `browser install`. Task 8's README documents `litewave browser install`; Task 9's bridge-script env value is `endpoint`.

- [ ] **Step 1: Write the failing tests**

Append to `test/runtime-paths.test.ts`:

```ts
import { homedir } from "node:os";
import { home } from "../src/storage.js";

test("LITEWAVE_HOME expands a leading ~ and resolves relative paths like Elixir's Path.expand", () => {
  const previous = process.env.LITEWAVE_HOME;
  try {
    process.env.LITEWAVE_HOME = "~/lw-home-test";
    assert.equal(home(), path.join(homedir(), "lw-home-test"));
    process.env.LITEWAVE_HOME = "relative-home";
    assert.equal(home(), path.resolve("relative-home"));
    process.env.LITEWAVE_HOME = "~";
    assert.equal(home(), homedir());
  } finally {
    if (previous === undefined) delete process.env.LITEWAVE_HOME;
    else process.env.LITEWAVE_HOME = previous;
  }
});
```

(`path` is already imported in that file; add `homedir` and `home` imports at the top.)

Append to `test/phoenix.test.ts`:

```ts
test("a project directory that does not exist is an invalid_request, not a raw ENOENT", async () => {
  const result = await callPhoenix(
    "/nonexistent/litewave/project",
    "phoenix_health",
  );
  assert.equal(result.status, "error");
  assert.equal(result.error?.code, "invalid_request");
  assert.match(result.error?.message ?? "", /does not exist/);
  assert.equal(result.error?.dispatch_occurred, false);
});
```

In `test/phoenix.test.ts` inside the socket test, after the `down` block that asserts `refused connections were never dispatched`, add a case where the HTTP fallback is also down and the message names both transports. Place it immediately after the `fallback` assertions (which prove the HTTP fallback works) and before `finally`:

```ts
httpServer.closeAllConnections();
await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
httpServer = undefined;
const bothDown = await callPhoenix(project, "phoenix_health");
assert.equal(bothDown.error?.code, "runtime_unavailable");
assert.match(bothDown.error?.message ?? "", /socket/);
assert.match(bothDown.error?.message ?? "", /endpoint/);
assert.match(bothDown.error?.message ?? "", /not running|down/);
```

In the `http fallback` test of `test/phoenix.test.ts`, change `assert.equal(target.kind, "http");` to `assert.equal(target.kind, "endpoint");`.

Append to `test/cli-runtime.test.ts`:

```ts
import { playwrightCli } from "../src/supervisor.js";
import { access } from "node:fs/promises";

test("browser install resolves the pinned Playwright CLI without running it", async () => {
  const cli = playwrightCli();
  assert.match(cli, /node_modules[\\/]playwright[\\/]cli\.js$/);
  await access(cli);
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npm run build && node --test dist/test/runtime-paths.test.js dist/test/phoenix.test.js dist/test/cli-runtime.test.js`
Expected: build fails on `home` not exported? `home` is already exported from `src/storage.ts`; the build fails on `playwrightCli` missing from `src/supervisor.ts`. Comment the `playwrightCli` test out temporarily only if you need to see the runtime failures: `~` test fails (`home()` returns `<cwd>/~/lw-home-test`), the nonexistent-project test fails with code `runtime_unavailable` and a message from the generic catch, the `bothDown` message lacks "endpoint", and the `endpoint` kind assertion fails with `"http"`.

- [ ] **Step 3: Implement**

`src/storage.ts`, replace `home`:

```ts
// Same normalisation as Elixir's Path.expand: a leading ~ is the home
// directory and a relative path resolves against the working directory.
export const home = () => {
  const configured = process.env.LITEWAVE_HOME;
  if (!configured) return path.join(homedir(), ".litewave");
  const expanded =
    configured === "~" || configured.startsWith("~/")
      ? path.join(homedir(), configured.slice(1))
      : configured;
  return path.resolve(expanded);
};
```

`src/phoenix.ts`:

1. `RuntimeTarget`: change `{ kind: "http"; endpoint: URL; tokenFile: string }` to `{ kind: "endpoint"; endpoint: URL; tokenFile: string }`. Update `resolveHttpTarget`'s returned literal `kind: "http"` to `kind: "endpoint"`, and in `callPhoenix`'s `send`, `if (t.kind === "http")` to `if (t.kind === "endpoint")`.
2. `resolveRuntime`: replace `const canonical = await realpath(project);` with

```ts
const canonical = await realpath(project).catch(
  (error: NodeJS.ErrnoException) => {
    throw new AccessError(
      "invalid_request",
      error.code === "ENOENT"
        ? `Project directory does not exist: ${project}`
        : `Project directory is not accessible: ${project}`,
    );
  },
);
```

3. `callPhoenix`, the fallback block. Replace

```ts
target = await resolveHttpTarget(target.project, target.projectId);
response = await send(target);
```

with

```ts
target = await resolveHttpTarget(target.project, target.projectId);
try {
  response = await send(target);
} catch (fallbackError) {
  if (fallbackError instanceof TransportError && !fallbackError.sent)
    throw new TransportError(
      "connection_failed",
      `socket: ${error.message}; endpoint: ${fallbackError.message}`,
      false,
    );
  throw fallbackError;
}
```

4. `callPhoenix`, the outer `catch`: replace the `!error.sent` message with

```ts
return runtimeFailure(
  "runtime_unavailable",
  `No runtime answered (${error.message}); the app is not running or has not published its runtime yet. Restart the app, then retry.`,
);
```

This covers refused connections and connect-phase timeouts with one truthful sentence; the existing `/not running|down/` assertions still match.

`src/mcp.ts`: browser tool description, append the sentence `Register a project with litewave init --project PATH, then start its browser with litewave browser open --project PATH.` to the existing description string. Replace the `not_registered` message with `"Browser access is not registered for this project. Run litewave init --project PATH (add --app URL if no Litewave runtime is running), then litewave browser open --project PATH."`. Make the identical message change in `src/storage.ts` where `"not_registered"` is thrown (`This project is not registered. ...`).

`src/supervisor.ts`: add

```ts
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

// The Playwright package pinned in package.json ships its CLI as cli.js
// beside package.json; "playwright/cli" is not an exported subpath.
export function playwrightCli(): string {
  const pkg = createRequire(import.meta.url).resolve("playwright/package.json");
  return path.join(path.dirname(pkg), "cli.js");
}

// Installs the pinned Chromium build. Nothing calls this automatically.
export function installBrowser(): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [playwrightCli(), "install", "chromium"],
      {
        stdio: "inherit",
      },
    );
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}
```

(`path` is imported in `src/supervisor.ts` already; if not, add `import path from "node:path";`.)

`src/cli.ts`: before `if (command.startsWith("phoenix ")) {`, add

```ts
if (command === "browser install") {
  process.exitCode = await installBrowser();
  return;
}
```

and import `installBrowser` from `./supervisor.js`. In `HELP`, add the line `  litewave browser install` directly under the `litewave init` line, and change the sentence `browser open is the only command that launches Chromium.` to `browser install downloads the pinned Chromium once; browser open is the only command that launches it.`

`src/index.ts`: add `export { playwrightCli, installBrowser } from "./supervisor.js";`.

`test/phoenix-bridge.integration.mjs`: change the default `?? "http"` to `?? "endpoint"`, every `transportKind === "http"` to `transportKind === "endpoint"`, `id: "http-fixture"` to `id: "endpoint-fixture"`, and replace the mapping

```js
assert.equal(
  health.transport,
  transportKind === "http" ? "endpoint" : transportKind,
  JSON.stringify(health),
);
```

with `assert.equal(health.transport, transportKind, JSON.stringify(health));` and delete the two-line comment above it.

`packages/phoenix/test/http_test.exs:65`: `{"LITEWAVE_FIXTURE_TRANSPORT", "http"}` → `{"LITEWAVE_FIXTURE_TRANSPORT", "endpoint"}`.

`test/cli-runtime.test.ts`, first test: the line `process.env.LITEWAVE_HOME = home;` mutates the test process for every later test. Replace with

```ts
const previousHome = process.env.LITEWAVE_HOME;
process.env.LITEWAVE_HOME = home;
```

and in that test's `finally` block add, first:

```ts
if (previousHome === undefined) delete process.env.LITEWAVE_HOME;
else process.env.LITEWAVE_HOME = previousHome;
```

If the test has no `finally`, wrap its body after the `process.env` assignment in `try { ... } finally { ... }` with the existing `rm(root, ...)` cleanup kept inside `finally`.

- [ ] **Step 4: Run both gates**

Run: `npm run check`
Expected: lint clean, 16 tests pass (13 + 3 new), 0 fail.

Run: `(cd packages/phoenix && mix precommit)`
Expected: `44 tests, 0 failures, 3 excluded` style summary (41 passed, 3 excluded); the HTTP bridge test passes over transport `endpoint`.

- [ ] **Step 5: Commit**

```bash
git add src test packages/phoenix/test/http_test.exs
git -c commit.gpgsign=false commit -m "Name the Plug transport endpoint in Node, expand ~ in LITEWAVE_HOME, and add browser install"
```

---

### Task 3: Elixir listener and application follow-ups

**Files:**

- Modify: `packages/phoenix/lib/litewave/socket_plug.ex`, `packages/phoenix/lib/litewave/listener.ex`, `packages/phoenix/lib/litewave/application.ex`
- Modify: `packages/phoenix/test/listener_test.exs`, `packages/phoenix/test/runtime_test.exs`, `packages/phoenix/test/paths_test.exs`

**Interfaces:**

- Consumes: `Litewave.Handler.respond/3`, `Litewave.Runtime.error/3`, `Litewave.Paths.for_project/2`.
- Produces: `Litewave.Application.children(enabled :: boolean, environment :: atom) :: [Supervisor.child_spec()]` (arity changes from 1 to 2); `Litewave.Listener.info/1` returns computed `socket`/`descriptor` paths even when start fails after paths were derived. Task 5 documents both.

- [ ] **Step 1: Write the failing tests**

`packages/phoenix/test/listener_test.exs`, add to the first test (`publishes a private socket and descriptor...`) after its existing permission assertions:

```elixir
    assert (File.stat!(Path.dirname(ctx.paths.descriptor)).mode &&& 0o777) == 0o700
```

Append these tests to the module:

```elixir
  test "unknown paths get the JSON error envelope with no-store", ctx do
    start(ctx)
    response = Req.get!("http://localhost/other", unix_socket: ctx.paths.socket, retry: false)
    assert response.status == 404
    assert Req.Response.get_header(response, "cache-control") == ["no-store"]
    assert %{"error" => %{"code" => "not_found", "dispatch_occurred" => false}} = response.body
  end

  test "sweeps abandoned partial descriptors before publishing", ctx do
    directory = Path.dirname(ctx.paths.descriptor)
    File.mkdir_p!(directory)
    partial = ctx.paths.descriptor <> ".123.partial"
    File.write!(partial, "{")
    start(ctx)
    refute File.exists?(partial)
    assert File.exists?(ctx.paths.descriptor)
  end

  test "reports disabled and removes its files when the bound server exits", ctx do
    listener = start(ctx)
    %{server: server} = :sys.get_state(listener)

    log =
      capture_log(fn ->
        Process.exit(server, :kill)
        eventually(fn -> Listener.info(listener).status == :disabled end)
      end)

    assert %{status: :disabled, reason: "listener exited: killed"} = Listener.info(listener)
    refute File.exists?(ctx.paths.socket)
    refute File.exists?(ctx.paths.descriptor)
    assert log =~ "listener exited"
  end

  # A live conflicting socket is the one start failure that is provable
  # without racing the filesystem; the code change below extends the same
  # guarantee to exceptions raised after the paths are derived.
  test "info names the paths it derived even when starting fails", ctx do
    start(ctx)
    {second, _log} = with_log(fn -> start(ctx, id: :second) end)
    info = Listener.info(second)
    assert info.status == :disabled
    assert info.reason =~ "another runtime already serves"
    assert info.socket == ctx.paths.socket
    assert info.descriptor == ctx.paths.descriptor
  end

  defp eventually(fun, attempts \\ 100) do
    cond do
      fun.() ->
        :ok

      attempts > 0 ->
        Process.sleep(20)
        eventually(fun, attempts - 1)

      true ->
        flunk("condition not met within 2 s")
    end
  end
```

`with_log/1` and `capture_log/1` come from `ExUnit.CaptureLog`, already imported in this file.

`packages/phoenix/test/runtime_test.exs`:

Replace the test `the listener child is controlled by the enabled flag` with:

```elixir
  test "the listener child is controlled by the enabled flag and a production host starts nothing" do
    children = Supervisor.which_children(Litewave.Supervisor) |> Enum.map(&elem(&1, 0))
    refute Litewave.Listener in children, "test config sets enabled: false"
    assert Litewave.Listener in Litewave.Application.children(true, :dev)
    assert Litewave.Runtime in Litewave.Application.children(false, :test)
    refute Litewave.Listener in Litewave.Application.children(false, :test)
    assert Litewave.Application.children(true, :prod) == []
  end
```

Replace the test `app_url detection never loads code` with:

```elixir
  test "app_url detection never loads code" do
    # Whether the fixture module is already loaded depends on test order and
    # on whether this run compiled it; either way detect/0 must not change it.
    {:ok, agent} = Agent.start_link(fn -> nil end, name: Litewave.TestPhoenixEndpoint)
    loaded = :erlang.module_loaded(Litewave.TestPhoenixEndpoint)
    detected = Litewave.AppURL.detect()
    assert :erlang.module_loaded(Litewave.TestPhoenixEndpoint) == loaded
    assert detected == if(loaded, do: "http://localhost:4123", else: nil)
    Agent.stop(agent)
  end
```

Add:

```elixir
  test "socket config rejects a production environment" do
    assert_raise ArgumentError, ~r/development-only/, fn ->
      Litewave.Config.socket(environment: :prod)
    end
  end
```

`packages/phoenix/test/paths_test.exs`, extend `home is normalised like the Node side's path.resolve` with:

```elixir
    assert Litewave.Paths.home("~/lw-home-test") == Path.join(System.user_home!(), "lw-home-test")
    assert Litewave.Paths.home("relative-home") == Path.expand("relative-home")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `(cd packages/phoenix && mix test test/listener_test.exs test/runtime_test.exs test/paths_test.exs)`
Expected: compile error `Litewave.Application.children/2 is undefined` (arity); after temporarily reading past it, the 404 test fails on the missing `cache-control` header, the partial-sweep test fails on `refute File.exists?(partial)`, the EXIT test may already pass (cleanup exists) and stays as a pin, `paths_test` additions pass already (Path.expand handles `~`) and stay as pins.

- [ ] **Step 3: Implement**

`packages/phoenix/lib/litewave/socket_plug.ex`, replace the second `call/2` clause:

```elixir
  def call(conn, _config) do
    Litewave.Handler.respond(
      conn,
      404,
      Litewave.Runtime.error("not_found", "Unknown path.", false)
    )
  end
```

Remove the now-unused `import Plug.Conn` if the compiler warns about it.

`packages/phoenix/lib/litewave/application.ex`:

```elixir
  @impl true
  def start(_type, _args) do
    enabled = Application.get_env(:litewave_phoenix, :enabled, true)
    children = children(enabled, Litewave.Config.environment())
    Supervisor.start_link(children, strategy: :one_for_all, name: Litewave.Supervisor)
  end

  # Public so tests can assert the child list without restarting the app.
  # A production host gets no children at all: nothing can publish a socket.
  @doc false
  def children(enabled, environment) when environment in [:dev, :test] do
    [
      {Task.Supervisor, name: Litewave.TaskSupervisor},
      Litewave.Logs,
      Litewave.Runtime
    ] ++ if(enabled, do: [Litewave.Listener], else: [])
  end

  def children(_enabled, _environment), do: []
```

`packages/phoenix/lib/litewave/listener.ex`:

1. Replace `init/1` and add `boot/1` and `listen/2` so paths survive into the disabled state:

```elixir
  @impl true
  def init(opts) do
    Process.flag(:trap_exit, true)
    {:ok, boot(opts)}
  end

  # Nothing here may crash the host app: every failure becomes a :disabled
  # state with a reason. Paths are derived first so that even a failed start
  # reports where the socket and descriptor would have been.
  defp boot(opts) do
    config = Keyword.get_lazy(opts, :config, fn -> Litewave.Config.socket() end)
    paths = Paths.for_project(config.project, Keyword.get(opts, :home))
    listen(config, paths)
  rescue
    error -> disabled(%{socket: nil, descriptor: nil}, Exception.message(error))
  catch
    kind, reason -> disabled(%{socket: nil, descriptor: nil}, describe(kind, reason, __STACKTRACE__))
  end

  defp listen(config, paths) do
    case start(config, paths) do
      {:ok, server} ->
        %{
          status: :listening,
          server: server,
          socket: paths.socket,
          descriptor: paths.descriptor,
          reason: nil
        }

      {:error, reason} ->
        disabled(paths, reason)
    end
  rescue
    error -> disabled(paths, Exception.message(error))
  catch
    kind, reason -> disabled(paths, describe(kind, reason, __STACKTRACE__))
  end
```

2. In `start/2`, after `:ok <- private_dir(Path.dirname(paths.descriptor)),` add `:ok <- sweep_partials(paths.descriptor),` and define:

```elixir
  # A SIGKILL between writing and renaming leaves runtime.json.<n>.partial
  # behind; they are ours by construction and never read, so remove them.
  defp sweep_partials(descriptor) do
    (descriptor <> ".*.partial") |> Path.wildcard() |> Enum.each(&File.rm/1)
    :ok
  end
```

- [ ] **Step 4: Run the full gate**

Run: `(cd packages/phoenix && mix precommit)`
Expected: compile clean with warnings as errors, format clean, tests: 41 + 5 new = 46 passed, 3 excluded, 0 failures. (credo and dialyzer are added to the alias in Task 4; here `precommit` is still compile, format, test.)

- [ ] **Step 5: Commit**

```bash
git add packages/phoenix/lib packages/phoenix/test
git -c commit.gpgsign=false commit -m "Harden the runtime listener: envelope 404s, sweep partial descriptors, keep paths on failure, no children in prod"
```

---

### Task 4: Credo and Dialyzer in the Elixir precommit gate

**Files:**

- Modify: `packages/phoenix/mix.exs` (deps, aliases, dialyzer config), `packages/phoenix/mix.lock`
- Create: `packages/phoenix/.credo.exs`
- Modify: `.gitignore` (PLT directory)
- Modify: any `packages/phoenix/lib/**/*.ex` that credo strict or dialyzer flags

**Interfaces:**

- Consumes: Task 3's module shapes.
- Produces: `mix precommit` = `compile --warnings-as-errors`, `format --check-formatted`, `credo --strict`, `dialyzer`, `test`. Task 7's CI runs it and caches `packages/phoenix/priv/plts`.

- [ ] **Step 1: Add the dependencies, alias, and dialyzer configuration**

In `packages/phoenix/mix.exs` `deps/0` add:

```elixir
      {:credo, "~> 1.7", only: [:dev, :test], runtime: false},
      {:dialyxir, "~> 1.4", only: [:dev, :test], runtime: false}
```

Replace the `aliases:` entry in `project/0` with `aliases: aliases(),` and add:

```elixir
  defp aliases do
    [
      precommit: [
        "compile --warnings-as-errors",
        "format --check-formatted",
        "credo --strict",
        "dialyzer",
        "test"
      ]
    ]
  end
```

Add to `project/0`:

```elixir
      dialyzer: [
        plt_add_apps: [:mix, :iex, :ex_unit],
        plt_file: {:no_warn, "priv/plts/litewave_phoenix.plt"},
        flags: [:unmatched_returns, :error_handling, :extra_return, :missing_return]
      ],
```

Add to the root `.gitignore` under the Phoenix block: `/packages/phoenix/priv/plts/`.

Run: `(cd packages/phoenix && mix deps.get)`
Expected: credo, dialyxir, bunt, file_system, erlex added to `mix.lock`.

- [ ] **Step 2: Generate the credo config and run credo strict**

Run: `(cd packages/phoenix && mix credo gen.config && mix credo --strict)`
Expected: `.credo.exs` created with defaults; credo reports its findings and exits non-zero.

Edit `.credo.exs` once: in `files:`, set `included: ["lib/", "test/"]` and `excluded: [~r"/_build/", ~r"/deps/"]`. Leave every check at its default.

- [ ] **Step 3: Fix every credo finding**

Rules for fixing:

- Change the code, not the config. Typical findings: alias ordering, `unless` with `else`, nested `if`, large numbers without underscores, `@moduledoc` placement, trailing whitespace in heredocs, `Enum.map |> Enum.join` → `Enum.map_join`.
- `lib/litewave/introspection.ex` is upstream-derived (Apache-2.0, Tidewave). If a `Refactor.*` or `Readability.*` check fires there, add `# credo:disable-for-this-file Credo.Check.<Name>` at the top of that file with a one-line comment `# Kept close to the upstream Tidewave source; see NOTICE.` Do not disable checks anywhere else.
- If `Credo.Check.Refactor.CyclomaticComplexity` fires on `Litewave.Runtime.handle_call/3` or `Litewave.Config.base/1`, extract the branch bodies into private functions rather than raising the threshold.

Run: `(cd packages/phoenix && mix credo --strict)`
Expected: `found no issues` and exit 0.

- [ ] **Step 4: Build the PLT and fix dialyzer findings**

Run: `(cd packages/phoenix && MIX_ENV=test mix dialyzer)` (first run builds the PLT; expect several minutes)
Expected: dialyzer runs and lists warnings, or `done (passed successfully)`.

Fix each warning by correcting the code or its typespec. Rules:

- No `@dialyzer` attributes and no `.dialyzer_ignore.exs` unless the warning is about `Mix.Project.project_file/0` or `Mix.Project.get/0` being unavailable outside Mix; for exactly that case, create `packages/phoenix/.dialyzer_ignore.exs` listing the specific warning tuples and add `ignore_warnings: ".dialyzer_ignore.exs"` to the `dialyzer:` config.
- A `pattern_match` warning on a `catch`/`rescue` clause the reviews required (never-crash paths) is fixed by narrowing the pattern, not by removing the clause.

Run: `(cd packages/phoenix && MIX_ENV=test mix dialyzer)`
Expected: `done (passed successfully)`.

- [ ] **Step 5: Run the full gate**

Run: `(cd packages/phoenix && mix precommit)`
Expected: compile, format, `credo --strict` (no issues), `dialyzer` (passed), tests 46 passed / 3 excluded.

- [ ] **Step 6: Commit**

```bash
git add .gitignore packages/phoenix/mix.exs packages/phoenix/mix.lock packages/phoenix/.credo.exs packages/phoenix/lib
git -c commit.gpgsign=false commit -m "Add credo strict and dialyzer to the Phoenix precommit gate"
```

---

### Task 5: ex_doc, Hex metadata, and public module documentation

**Files:**

- Modify: `packages/phoenix/mix.exs` (metadata, `docs/0`, `package/0`, ex_doc dep)
- Modify: `packages/phoenix/lib/litewave.ex`, `packages/phoenix/lib/litewave/config.ex`, `packages/phoenix/lib/litewave/listener.ex`, `packages/phoenix/lib/litewave/paths.ex` (moduledocs, `@doc`, `@spec`, `@type`)
- Modify: `.gitignore` (`/packages/phoenix/doc/`)

**Interfaces:**

- Consumes: Task 3's `Application.children/2`, `Listener.info/1` contract.
- Produces: `Litewave.Config.t()` type; documented public API. Task 9's Phoenix README links to hexdocs module pages by these names.

- [ ] **Step 1: Add ex_doc and the package metadata**

In `packages/phoenix/mix.exs`, add module attributes and replace `project/0`, adding `docs/0` and `package/0`:

```elixir
  @version "0.1.0-alpha.1"
  @source_url "https://github.com/jtippett/litewave"

  def project do
    [
      app: :litewave_phoenix,
      version: @version,
      elixir: "~> 1.17",
      elixirc_paths: elixirc_paths(Mix.env()),
      deps: deps(),
      aliases: aliases(),
      dialyzer: [
        plt_add_apps: [:mix, :iex, :ex_unit],
        plt_file: {:no_warn, "priv/plts/litewave_phoenix.plt"},
        flags: [:unmatched_returns, :error_handling, :extra_return, :missing_return]
      ],
      name: "Litewave Phoenix",
      description:
        "Development-only Phoenix runtime tools for the Litewave CLI and MCP bridge, published on a private Unix socket at boot.",
      source_url: @source_url,
      homepage_url: @source_url,
      docs: docs(),
      package: package()
    ]
  end

  defp package do
    [
      licenses: ["MIT", "Apache-2.0"],
      maintainers: ["James Tippett"],
      links: %{
        "GitHub" => @source_url,
        "Changelog" => "#{@source_url}/blob/main/packages/phoenix/CHANGELOG.md"
      },
      files: ~w(lib mix.exs .formatter.exs README.md CHANGELOG.md LICENSE LICENSE-APACHE NOTICE)
    ]
  end

  defp docs do
    [
      main: "readme",
      source_ref: "v#{@version}",
      source_url_pattern: "#{@source_url}/blob/v#{@version}/packages/phoenix/%{path}#L%{line}",
      extras: ["README.md", "CHANGELOG.md"],
      groups_for_modules: [
        Integration: [Litewave],
        Configuration: [Litewave.Config],
        Internal: [Litewave.Listener, Litewave.Paths]
      ]
    ]
  end
```

Add the dep `{:ex_doc, "~> 0.40", only: :dev, runtime: false}` and add `/packages/phoenix/doc/` to the root `.gitignore`.

Run: `(cd packages/phoenix && mix deps.get && mix hex.build --unpack -o /tmp/lw-hex-build && ls /tmp/lw-hex-build && rm -rf /tmp/lw-hex-build)`
Expected: the unpacked tarball lists `CHANGELOG.md LICENSE LICENSE-APACHE NOTICE README.md hex_metadata.config lib mix.exs .formatter.exs`. If `mix hex.build` complains that `CHANGELOG.md` is missing, it exists at `packages/phoenix/CHANGELOG.md` already (created in plan 1); check the working directory.

- [ ] **Step 2: Document `Litewave`**

Replace the moduledoc in `packages/phoenix/lib/litewave.ex`:

```elixir
  @moduledoc """
  Development-only Phoenix runtime access for the Litewave CLI and MCP bridge.

  Adding `{:litewave_phoenix, "~> 0.1", only: :dev}` to your dependencies is
  the whole integration: at boot in `:dev` the application publishes its
  runtime tools on a private Unix socket (see `Litewave.Listener`). This
  module is the **alternative** transport, a Plug that serves the same tools
  on your application's HTTP port.

  ## Mounting the Plug

  Run `litewave phoenix setup --project PATH` once (after `litewave init`) and
  mount the printed line in your endpoint **before** `Plug.Parsers`:

      if Mix.env() == :dev do
        plug Litewave,
          project: "/absolute/path/to/app",
          endpoint: "http://localhost:4000",
          token_file: "/Users/you/.litewave/projects/<key>/phoenix-token",
          allow_eval: false,
          allow_sql: false
      end

  Or resolve everything from the CLI's registration:

      plug Litewave, registration: "/absolute/path/to/app"

  ## Options

  See `Litewave.Config.new/1` for every option. `project_id` is optional and
  defaults to the project key derived from the canonical project path; the
  Node bridge derives the same key. Options set under
  `config :litewave_phoenix` apply to this Plug as defaults; the Plug's own
  arguments win.

  ## What the Plug checks

  Every request to `/litewave/runtime` must come from a loopback peer, carry
  the exact configured `Host` and (if present) `Origin`, and present the
  token from `token_file` as a Bearer token. Other paths pass through
  untouched. Production configuration is refused at `init/1`.

  `allow_eval: true` executes arbitrary Elixir in your application and
  `allow_sql: true` runs **read-write** SQL through your Ecto repositories.
  Neither is a sandbox.
  """
```

Add specs:

```elixir
  @impl true
  @spec init(keyword()) :: Litewave.Config.t()
  def init(opts), do: Litewave.Config.new(opts)

  @impl true
  @spec call(Plug.Conn.t(), Litewave.Config.t()) :: Plug.Conn.t()
  def call(...)
```

(One `@spec` before the first `call/2` clause covers both clauses.)

- [ ] **Step 3: Document `Litewave.Config`**

Replace `@moduledoc false` in `packages/phoenix/lib/litewave/config.ex` with:

```elixir
  @moduledoc """
  Runtime configuration for both transports.

  Options may be given as arguments to the `Litewave` Plug or under
  `config :litewave_phoenix` in `config/dev.exs`. The socket transport
  started at boot reads only the application environment.

  | Option             | Default                                  | Meaning                                                                                  |
  | ------------------ | ---------------------------------------- | ---------------------------------------------------------------------------------------- |
  | `:enabled`         | `true`                                   | Publish the boot-time socket. Application environment only.                              |
  | `:allow_eval`      | `false`                                  | Allow `project_eval`. Executes arbitrary Elixir in the app; not a sandbox.               |
  | `:allow_sql`       | `false`                                  | Allow `execute_sql_query`. SQL is **read-write**.                                        |
  | `:repos`           | `:ecto_repos` of loaded applications     | Repositories SQL may target.                                                             |
  | `:roots`           | Mix dependency paths plus the project    | Directories `get_source_location` may reveal.                                            |
  | `:timeout`         | `10_000`                                 | Execution timeout in ms, at most `30_000`.                                               |
  | `:max_output_bytes`| `64_000`                                 | Bound on captured output, `1_024..256_000`.                                              |
  | `:max_rows`        | `50`                                     | SQL rows returned, at most `500`.                                                        |
  | `:project`         | the Mix project directory                | Canonical project path. Socket transport: application environment or default.           |
  | `:environment`     | the host `Mix.env()`                     | Must be `:dev` or `:test`. Plug argument only.                                           |
  | `:project_id`      | `Litewave.Paths.key(project)`            | Plug argument only; the default is what the CLI expects.                                 |
  | `:endpoint`        | required for the Plug                    | Loopback origin the Plug is served on, e.g. `"http://localhost:4000"`.                   |
  | `:token_file`      | required for the Plug                    | Private file created by `litewave phoenix setup`.                                        |
  | `:registration`    | —                                        | Plug only: resolve `project`, `endpoint`, `token_file` from the CLI's files for this path.|

  Every option is validated at boot or at `Plug.init/1`; an invalid value
  raises `ArgumentError` so a misconfiguration is visible immediately.
  """
```

Add the struct type and specs:

```elixir
  @typedoc "Validated configuration shared by the socket listener and the Plug."
  @type t :: %{
          project: String.t(),
          project_id: String.t(),
          owner_uid: non_neg_integer(),
          environment: :dev | :test,
          roots: [String.t()],
          repos: [module()],
          allow_eval: boolean(),
          allow_sql: boolean(),
          max_output_bytes: pos_integer(),
          max_rows: pos_integer(),
          timeout: pos_integer(),
          transport: :socket | :endpoint,
          endpoint: URI.t() | nil,
          token_file: String.t() | nil
        }

  @doc """
  The Mix environment of the *host* application, or `:prod` when no Mix
  project is running (releases). Dependencies compile under `:prod` even in a
  development host, so `Mix.env/0` of this package is never consulted.
  """
  @spec environment() :: atom()
  def environment do

  @doc """
  Builds the Plug configuration (transport `:endpoint`) from Plug arguments
  merged over `:litewave_phoenix` application environment. See the module
  documentation for the options. Raises `ArgumentError` on invalid or
  production configuration.
  """
  @spec new(keyword()) :: t()
  def new(opts) when is_list(opts) do

  @doc """
  Builds the boot-time socket configuration (transport `:socket`) from
  application environment merged under `opts`. The project defaults to the
  directory of the running Mix project, canonicalised. Raises
  `ArgumentError` on invalid or production configuration.
  """
  @spec socket(keyword()) :: t()
  def socket(opts \\ []) when is_list(opts) do

  @doc false
  @spec token(Path.t(), non_neg_integer()) :: {:ok, String.t()} | {:error, :invalid_token_file}
  def token(file, owner_uid) do

  @doc false
  @spec current_uid() :: non_neg_integer()
  def current_uid do
```

- [ ] **Step 4: Document `Litewave.Listener` and `Litewave.Paths`**

`packages/phoenix/lib/litewave/listener.ex`:

```elixir
  @moduledoc """
  Publishes the runtime tools on a private Unix domain socket at boot.

  Started by the application supervisor in `:dev` and `:test` when
  `config :litewave_phoenix, enabled: true` (the default). On start it:

  1. secures `$LITEWAVE_HOME`, `projects/`, `run/`, and the project directory
     as owner-only (`0700`), refusing directories owned by another user;
  2. removes a stale socket only if connecting to it is refused;
  3. binds Bandit to `run/p<key16>.sock` and sets the socket to `0600`;
  4. writes `projects/<key>/runtime.json` atomically.

  Any failure leaves the host application running: the listener logs one
  warning and reports `status: :disabled` from `info/1`. It does not retry;
  restart the application after fixing the cause. Stopping the application
  removes the socket and descriptor.

  `LITEWAVE_HOME` must be the same absolute path for the application and for
  every CLI/MCP client of the project; a symlinked home is refused.
  """

  @doc """
  Starts the listener. Options: `:config` (a `Litewave.Config.t()`, default
  `Litewave.Config.socket/1`), `:home` (overrides `LITEWAVE_HOME`), `:name`
  (`nil` for an unnamed process; default `Litewave.Listener`).
  """
  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts) do

  @doc """
  Current state: `%{status: :listening | :disabled, socket: path | nil,
  descriptor: path | nil, reason: String.t() | nil}`. Useful in IEx when the
  CLI reports that no runtime is published.
  """
  @spec info(GenServer.server()) :: %{
          status: :listening | :disabled,
          socket: Path.t() | nil,
          descriptor: Path.t() | nil,
          reason: String.t() | nil
        }
  def info(server \\ __MODULE__), do: GenServer.call(server, :info)
```

`packages/phoenix/lib/litewave/paths.ex`:

```elixir
  @moduledoc """
  Where Litewave keeps its files, derived identically by the Node bridge.

  * home: `LITEWAVE_HOME` or `~/.litewave`, expanded like `Path.expand/1`
  * project key: first 24 hex characters of SHA-256 of the canonical project path
  * socket: `<home>/run/p<first 16 of key>.sock`
  * descriptor: `<home>/projects/<key>/runtime.json`

  macOS limits socket paths to about 100 bytes; `check_length/1` enforces it.
  """

  @doc "The Litewave home directory: `override`, else `LITEWAVE_HOME`, else `~/.litewave`."
  @spec home(Path.t() | nil) :: Path.t()
  def home(override \\ nil) do

  @doc "The project key for a canonical project path."
  @spec key(String.t()) :: String.t()
  def key(project) when is_binary(project) do

  @doc "Home, key, socket and descriptor paths for a canonical project path."
  @spec for_project(String.t(), Path.t() | nil) :: %{
          home: Path.t(),
          key: String.t(),
          socket: Path.t(),
          descriptor: Path.t()
        }
  def for_project(project, home_override \\ nil) do

  @doc "Refuses socket paths longer than 100 bytes with a message naming `LITEWAVE_HOME`."
  @spec check_length(Path.t()) :: :ok | {:error, String.t()}
  def check_length(socket) when byte_size(socket) > 100, do: {:error, @too_long}

  @doc """
  Creates `dir` if needed and makes it owner-only (`0700`). Returns
  `{:error, :not_owned}` for another user's directory and
  `{:error, :not_a_directory}` for a symlink or file.
  """
  @spec private_dir(Path.t()) :: :ok | {:error, :not_owned | :not_a_directory | File.posix()}
  def private_dir(dir) do
```

- [ ] **Step 5: Build the docs and run the gate**

Run: `(cd packages/phoenix && mix docs 2>&1 | tee /tmp/lw-docs.log; grep -ci warning /tmp/lw-docs.log; grep -c "Integration\|Configuration\|Internal" doc/api-reference.html)`
Expected: warning count `0`; the group names appear in `doc/api-reference.html` (count ≥ 3). Fix any "documentation references function ... but it is undefined or private" warning by correcting the reference.

Run: `(cd packages/phoenix && mix precommit)`
Expected: all five steps pass; dialyzer accepts the new specs (a spec that disagrees with the implementation shows up here; fix the spec unless the implementation is wrong).

- [ ] **Step 6: Commit**

```bash
git add .gitignore packages/phoenix/mix.exs packages/phoenix/mix.lock packages/phoenix/lib
git -c commit.gpgsign=false commit -m "Add ex_doc, Hex package metadata, and documentation for the public modules"
```

---

### Task 6: npm package metadata and tarball contents

**Files:**

- Modify: `package.json`, `NOTICE`
- Create: `test/package.test.ts`

**Interfaces:**

- Consumes: Task 1's `lint` script.
- Produces: a publishable `package.json`. Task 7 (CI) and plan 3 (publish workflow) rely on `prepublishOnly` and the `files` list.

- [ ] **Step 1: Write the failing test**

Create `test/package.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
// Compiled to dist/test/, so the repository root is two levels up.
const root = fileURLToPath(new URL("../../", import.meta.url));
const pkg = JSON.parse(
  await readFile(new URL("../../package.json", import.meta.url), "utf8"),
) as {
  name: string;
  private?: boolean;
  repository: { url: string };
  homepage: string;
  bugs: { url: string };
  keywords: string[];
  engines: { node: string };
  scripts: Record<string, string>;
  files: string[];
};

test("package metadata is publishable", () => {
  assert.equal(pkg.name, "litewave");
  assert.equal(pkg.private, undefined);
  assert.equal(
    pkg.repository.url,
    "git+https://github.com/jtippett/litewave.git",
  );
  assert.equal(pkg.bugs.url, "https://github.com/jtippett/litewave/issues");
  assert.match(pkg.homepage, /github\.com\/jtippett\/litewave/);
  assert.ok(pkg.keywords.includes("mcp") && pkg.keywords.includes("phoenix"));
  assert.equal(pkg.engines.node, ">=24.21.0");
  assert.equal(pkg.scripts.prepublishOnly, "npm run check");
  assert.equal(
    pkg.scripts.postinstall,
    undefined,
    "Chromium is installed only explicitly",
  );
  assert.equal(pkg.scripts.lint, "oxlint src test");
});

test("npm pack ships the CLI, notices, and architecture doc and nothing private", async () => {
  const { stdout } = await run("npm", ["pack", "--dry-run", "--json"], {
    cwd: root,
  });
  const files = (
    JSON.parse(stdout) as [{ files: { path: string }[] }]
  )[0].files.map((f) => f.path);
  for (const required of [
    "package.json",
    "dist/src/cli.js",
    "dist/src/index.js",
    "dist/src/index.d.ts",
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
    "NOTICE",
    "docs/architecture.md",
  ])
    assert.ok(files.includes(required), `${required} must be in the tarball`);
  for (const forbidden of [
    "dist/test/",
    "test/",
    "src/",
    "packages/",
    "local-feedback/",
    "docs/status.md",
    ".oxlintrc.json",
  ])
    assert.ok(
      files.every((f) => !f.startsWith(forbidden)),
      `${forbidden} must not be in the tarball`,
    );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node --test dist/test/package.test.js`
Expected: FAIL on `pkg.private` being `true`, `repository` undefined, `engines.node` `>=24.21.0 <25`, and `CHANGELOG.md` absent from the pack list.

- [ ] **Step 3: Update package.json and NOTICE**

`package.json` (keep every field not mentioned):

```json
  "name": "litewave",
  "version": "0.1.0-alpha.1",
  "description": "Local browser access and Phoenix runtime tools for coding agents: a persistent Chromium driven through a CLI or MCP server, with honest action outcomes.",
  "keywords": ["mcp", "playwright", "browser", "agent", "coding-agent", "phoenix", "elixir", "cli"],
  "homepage": "https://github.com/jtippett/litewave#readme",
  "bugs": { "url": "https://github.com/jtippett/litewave/issues" },
  "repository": { "type": "git", "url": "git+https://github.com/jtippett/litewave.git" },
  "author": "James Tippett",
  "license": "MIT",
  "type": "module",
  "engines": { "node": ">=24.21.0" },
  "files": ["dist/src", "README.md", "CHANGELOG.md", "LICENSE", "NOTICE", "docs/architecture.md"],
```

Remove `"private": true`. Add `"prepublishOnly": "npm run check"` to `scripts`. Field order: name, version, description, keywords, homepage, bugs, repository, author, license, type, engines, bin, exports, files, scripts, dependencies, devDependencies.

`NOTICE`: change `See docs/dependency-licenses.md for the installed package license inventory.` to `The repository's docs/dependency-licenses.md lists the installed package license inventory.` (that file is no longer shipped in the tarball).

- [ ] **Step 4: Run the gate**

Run: `npm run check`
Expected: prettier reformats nothing (run `npm run format` first if `package.json` field order tripped it), lint clean, 18 tests pass (16 + 2 new).

- [ ] **Step 5: Commit**

```bash
git add package.json NOTICE test/package.test.ts
git -c commit.gpgsign=false commit -m "Publishable npm metadata with a tarball contents test"
```

---

### Task 7: CI on the supported version matrix

**Files:**

- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: `npm run check` (Task 1, 6), `mix precommit` with dialyzer (Task 4), PLT path `packages/phoenix/priv/plts` (Task 4).
- Produces: the `CI` workflow whose `node` and `phoenix` jobs plan 3's release workflow will require to pass.

- [ ] **Step 1: Replace the workflow**

Write `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
jobs:
  node:
    name: Node ${{ matrix.node }} on ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, ubuntu-latest]
        node: ["24.21.0", "26"]
    runs-on: ${{ matrix.os }}
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: npm
      - run: npm ci
      - run: npm run check
      - run: npx --no-install playwright install --with-deps chromium
      - run: npm run test:browser

  phoenix:
    name: Elixir ${{ matrix.elixir }} / OTP ${{ matrix.otp }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - elixir: "1.17.3"
            otp: "27"
          - elixir: "1.20.4"
            otp: "29"
    runs-on: ubuntu-latest
    timeout-minutes: 20
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: litewave_phoenix_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    env:
      MIX_ENV: test
      LITEWAVE_TEST_DATABASE_URL: postgresql://postgres:postgres@localhost:5432/litewave_phoenix_test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .node-version
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: erlef/setup-beam@v1
        with:
          otp-version: ${{ matrix.otp }}
          elixir-version: ${{ matrix.elixir }}
      - uses: actions/cache@v4
        with:
          path: |
            packages/phoenix/deps
            packages/phoenix/_build
          key: mix-${{ runner.os }}-${{ matrix.otp }}-${{ matrix.elixir }}-${{ hashFiles('packages/phoenix/mix.lock') }}
          restore-keys: mix-${{ runner.os }}-${{ matrix.otp }}-${{ matrix.elixir }}-
      - uses: actions/cache@v4
        with:
          path: packages/phoenix/priv/plts
          key: plt-${{ runner.os }}-${{ matrix.otp }}-${{ matrix.elixir }}-${{ hashFiles('packages/phoenix/mix.lock') }}
          restore-keys: plt-${{ runner.os }}-${{ matrix.otp }}-${{ matrix.elixir }}-
      - run: mix deps.get
        working-directory: packages/phoenix
      - run: mix precommit
        working-directory: packages/phoenix
```

- [ ] **Step 2: Validate the YAML and the matrix locally**

Run: `ruby -ryaml -e 'y = YAML.load_file(".github/workflows/ci.yml"); puts y["jobs"].keys.inspect; puts y["jobs"]["phoenix"]["strategy"]["matrix"]["include"].inspect'`
Expected: `["node", "phoenix"]` and the two Elixir/OTP pairs.

- [ ] **Step 3: Try Elixir 1.17 locally if mise can supply it**

Run: `mise install erlang@27 elixir@1.17.3-otp-27 2>&1 | tail -3`
Then: `(cd packages/phoenix && mise exec erlang@27 elixir@1.17.3-otp-27 -- sh -c 'mix local.hex --force >/dev/null && mix local.rebar --force >/dev/null && MIX_ENV=test mix deps.get && MIX_ENV=test mix compile --warnings-as-errors && MIX_ENV=test mix test')`
Expected: compile clean, tests pass with 3 excluded. If `mise install` fails (network or build time over ten minutes), stop, record "1.17 verified in CI only" in the ledger, and continue. If compilation fails on 1.17 with a small fix (a function introduced after 1.17), apply the fix here; if not small, change `elixir: "~> 1.17"` to the lowest version that passes, update the matrix's first row, and record the decision (spec 6.1).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git -c commit.gpgsign=false commit -m "CI: Node 24 and 26 on macOS and Ubuntu; Elixir 1.17/OTP 27 and 1.20/OTP 29 with PLT caching"
```

---

### Task 8: Root documentation: README, SECURITY, CONTRIBUTING, AGENTS, example

**Files:**

- Rewrite: `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `AGENTS.md`, `examples/langelic.md`
- Modify: `docs/browser-crash-investigation.md` (three sentences), `docs/architecture.md` ("Phoenix connection" section)

**Interfaces:**

- Consumes: `litewave browser install` (Task 2), the message wording of Task 2, module names of Task 5.
- Produces: the README that is the npm front page and the docs Task 9 links back to (`docs/status.md`, `docs/design/2026-09-15-original-spec.md`, `packages/phoenix/README.md`).

- [ ] **Step 1: Write `README.md`**

````markdown
# Litewave

Local browser access and Phoenix runtime tools for coding agents.

Litewave keeps a dedicated Chromium open on your machine and lets an agent drive it through a CLI or an MCP server: navigate, click, fill, upload, download, screenshot, and read the accessibility tree. Every mutation is journaled with a caller-chosen request ID, so a lost response is reported as unknown, never as success, and is never replayed automatically.

For Phoenix applications, an optional development dependency publishes runtime tools (docs, source locations, logs, evaluation, SQL) on a private Unix socket at boot. No port, token, or endpoint change is needed, and the tools work without an open browser.

Everything stays on your machine. There is no Litewave account, relay, or model subscription.

## Requirements

- macOS. Linux runs in CI but is not yet a supported platform.
- Node 24.21.0 or newer. `.nvmrc` and `.node-version` pin the development version.
- Your application already running. Litewave never starts, restarts, or repairs it.

## Install

### CLI and MCP server

```sh
npm install -g litewave
litewave browser install
```
````

`browser install` downloads the pinned Chromium build once. Nothing is installed automatically. Prefer not to install globally? Prefix every command below with `npx litewave` instead.

### Phoenix runtime tools

Add the development-only dependency and restart your app:

```elixir
# mix.exs
{:litewave_phoenix, "~> 0.1", only: :dev}
```

That is the whole install. Details, options, and the alternative HTTP transport are in the [Phoenix package README](packages/phoenix/README.md).

## First session

Register the project. When the Phoenix app is running with `litewave_phoenix`, the app URL is read from it; otherwise pass `--app`.

```sh
litewave init --project /absolute/path/to/app
litewave browser open --project /absolute/path/to/app
```

`init` prints an MCP server entry with absolute Node and CLI paths. Add it to your agent's MCP configuration; Litewave never edits agent configuration itself. Sign into your app normally in the dedicated browser. The profile persists, so you sign in once.

Every browser operation uses the same JSON schema and response envelope through the CLI, the library, and the MCP `browser` tool. List tabs, then act on one:

```sh
litewave call --project /absolute/path/to/app --json '{"method":"tabs","requestId":"tabs-1"}'
```

```json
{
  "method": "navigate",
  "requestId": "home-1",
  "tabId": "TAB_ID",
  "url": "http://localhost:4000"
}
```

```json
{
  "method": "click",
  "requestId": "export-1",
  "tabId": "TAB_ID",
  "target": { "kind": "role", "role": "button", "name": "Export" },
  "postcondition": {
    "target": { "kind": "role", "role": "heading", "name": "Export ready" },
    "state": "visible"
  }
}
```

Use a new request ID for each intended mutation. After a lost response, query `action_status` with `actionId: "export-1"`: the same ID returns the prior state and never clicks again. `dispatched` means the browser call completed; `postcondition_met` confirms the requested observation; `outcome_unknown` means investigate, not that the app failed.

Runtime tools need no browser:

```sh
litewave phoenix status --project /absolute/path/to/app
litewave phoenix call --project /absolute/path/to/app --tool get_docs --json '{"reference":"Enum.map/2"}'
litewave mcp --project /absolute/path/to/app
```

## Guides

- [Phoenix package](packages/phoenix/README.md): install, options, tool behaviour, the HTTP Plug alternative.
- [Security model](SECURITY.md)
- [Architecture](docs/architecture.md)
- [Capability matrix](docs/status.md)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Example: a LiveView application](examples/langelic.md)
- [Original design specification](docs/design/2026-09-15-original-spec.md)

## Reference

### Locators, waits, files

Locators support exact role/name, test ID, and explicit CSS. Ambiguous targets fail. Supply `revision` from a snapshot to reject an action after navigation.

- `snapshot`: bounded accessibility text, optionally scoped to a target. Truncation is explicit.
- `wait`: a target, `state: "visible"` or `"hidden"`, and optional `timeoutMs` up to 30 seconds.
- `screenshot`: viewport by default, `fullPage: true`, or `target` for an element. Returns a local PNG path; password inputs are masked.
- `upload`: a file-input `target` and absolute `paths` inside registered upload roots. `paths: []` clears the selection. Selection does not confirm server import.
- Downloads are captured from every tab from creation, before click dispatch. Poll `downloads` for `complete`, retained `path`, size, and SHA-256. Each download gets its own directory.

Full schemas: [src/protocol.ts](src/protocol.ts). Library exports: [src/index.ts](src/index.ts).

### Upload folders

Uploads are optional. Browser uploads send local files to your app, so Litewave limits selection to folders you allow explicitly; the agent cannot pick arbitrary local files. Use an existing folder of files you intend to upload, such as a fixture directory. Subfolders are allowed; symlinks cannot escape the boundary.

```sh
litewave init --project /absolute/path/to/app --upload-root /absolute/path/to/fixtures
```

For an existing registration, `doctor` shows the configured folders and the registration file. To change them: finish active actions, `stop`, edit only `uploadRoots` in that file, then `browser open`. There is no registration-update command yet.

### Browser version and profile transitions

Litewave pins Playwright 1.62.0 / Chromium 151.0.7922.34 to avoid a reproduced Chromium 153/154 crash on restart with retained downloads; see [the investigation](docs/browser-crash-investigation.md). It refuses to open a profile last used by a newer Chromium. To create a compatible replacement while keeping the old profile:

```sh
litewave stop --project /absolute/path/to/app
litewave browser open --project /absolute/path/to/app --fresh-profile
```

Sign in again, or add `--storage-state /absolute/path/to/state.json` to import an explicitly exported Playwright storage state. That file contains authentication: keep it private and delete it after import. Litewave never exports authentication or copies cookies from another browser.

### Ownership and troubleshooting

```sh
litewave doctor --project /absolute/path/to/app
litewave stop --project /absolute/path/to/app
```

`doctor` probes the app over HTTP, the browser worker, and the Phoenix runtime separately. `stop` closes the owned browser and worker and refuses while an action or download is active. Closing an MCP client only detaches it.

State lives in `~/.litewave` with owner-only permissions. `LITEWAVE_HOME` relocates it: use a short absolute path (socket paths are limited to about 100 bytes on macOS), not a symlink, and set the **same value for the app and every CLI/MCP client** of a project; the MCP entry printed by `init` includes it. Project identity is the canonical project directory, so each worktree gets its own registration, profile, and runtime socket.

Litewave never kills an unknown browser or deletes a profile lock. After a verified close it may let Chromium reacquire its own leftover lock only when the recorded owner is absent and the profile evidence matches. Worker death currently loses volatile tab state; saved downloads remain on disk.

## Status

Litewave is a development alpha. Browser access and the Phoenix runtime tools work and are covered by contract tests, real-browser suites, and a real MCP client over the socket. Not yet implemented: automatic worker recovery, snapshot references and frames, dialogs, drag and scroll, enforced read-only SQL, and Windows or Linux support. The [capability matrix](docs/status.md) lists what is tested and what remains.

## Contributing and licence

Start with [CONTRIBUTING.md](CONTRIBUTING.md). Original code is [MIT licensed](LICENSE); dependency and upstream notices are in [NOTICE](NOTICE). The Phoenix package additionally carries Apache-2.0 attribution for code adapted from Tidewave.

````

- [ ] **Step 2: Write `SECURITY.md`**

```markdown
# Security model

Litewave grants substantial control over a local browser and, with the Phoenix package, over a running development application. Treat access to the CLI or MCP connection as access to the application's authenticated session, and treat `allow_eval` and `allow_sql` as code execution in your app.

## Boundaries

**Same user, same machine.** State lives under `~/.litewave` (or `LITEWAVE_HOME`) with owner-only permissions. A process running as the same OS user can read it; Litewave is not a sandbox against that user. Native peer-credential checks are not implemented.

**Browser worker.** The CLI and MCP bridge reach the browser worker over a user-owned Unix socket with a registration secret that is passed only over that socket, never in command arguments or MCP output. Agent navigation is restricted to the registered origins. This is not a network firewall: subresources can contact other hosts and a person can navigate manually. Cookies are never copied from an everyday browser. Page evaluation is not exposed.

**Phoenix runtime, socket transport (default).** At boot in `:dev` the app publishes `runtime.json` and a Unix socket under `LITEWAVE_HOME`. Identity is the project key, the SHA-256 of the canonical project path. Every directory from the home down is created `0700` and must be owned by the current user; the socket is `0600`. The Node bridge checks the run directory and socket ownership before connecting. No token is used: a filesystem socket is unreachable from a web page, so the Host/Origin/token checks of the HTTP transport are unnecessary. Only a socket that refuses connections is ever replaced; a live one is reported, never removed.

**Phoenix runtime, HTTP transport (alternative).** The `Litewave` Plug accepts only loopback peers with the exact configured Host, an absent or exact Origin, and a Bearer token read from a private (`0600`, owned) file. It refuses production configuration at startup and never follows redirects.

**Execution.** `project_eval` runs arbitrary Elixir in the application. `execute_sql_query` runs **read-write** SQL through the configured Ecto repositories. Both are off by default and, when enabled, grant write-capable access to whoever can reach the socket. Execution history is in memory and is not an audit log.

**Files.** Upload paths are canonicalised and checked against the allowed roots; this does not defend against a malicious same-user process racing filesystem changes. Downloads get sanitised names in unique owned directories. Screenshots mask password inputs, but other page content can be private. Review artifacts before sharing them; Litewave never uploads them.

## Not yet implemented

Diagnostic retention limits, capture budgets, a complete local threat-model test suite, and a durable Phoenix execution audit log. Files persist until you delete them. Stop the worker before removing a registration by hand.

## Reporting a vulnerability

Report privately through GitHub: <https://github.com/jtippett/litewave/security/advisories/new>. The maintainer is James Tippett (`@jtippett`). Please do not open public issues for security reports and do not include credentials or customer data in reproductions. Expect an acknowledgement within a week.
````

- [ ] **Step 3: Write `CONTRIBUTING.md`**

````markdown
# Contributing to Litewave

Litewave is a community project hosted at <https://github.com/jtippett/litewave>, maintained by James Tippett (`@jtippett`). Its core must work with ordinary web pages, React/Inertia, and Phoenix LiveView. Application-specific routes, selectors, and queries belong in `examples/` or in external integration tests, never in the core.

## Development

Use Node 24.21.0 (`.nvmrc`), then:

```sh
npm ci
npm run browser:install
npm run check              # prettier, oxlint, build, unit and contract tests
npm run test:browser       # real Chromium against a local fixture app
LITEWAVE_TEST_HEADED=1 npm run test:browser
```
````

The browser suite runs a deterministic loopback fixture server with an isolated temporary profile. It starts no external application and uses no account. Unit tests run without a browser. macOS is the supported platform; Linux CI is supplemental evidence.

## Phoenix package

Build the Node bridge first (`npm run build`), then:

```sh
cd packages/phoenix
mix deps.get
mix precommit              # compile --warnings-as-errors, format, credo --strict, dialyzer, test
```

Set `LITEWAVE_TEST_DATABASE_URL` to a dedicated disposable PostgreSQL database to include the SQL tests; without it they are excluded. Never point them at a real database. CI runs Elixir 1.17 on OTP 27 and Elixir 1.20 on OTP 29.

## Changes and reviews

- Explain the user-visible behaviour, its boundaries, and how you validated it in the pull request.
- Read `docs/status.md` (capability matrix) and, for background, `docs/design/2026-09-15-original-spec.md` before adding a capability.
- Browser operations live in the core. CLI and MCP share the schema and implementation.
- Use public Playwright APIs and the official MCP SDK. Do not import undocumented internals.
- Never replay an uncertain mutation automatically. Add a failure regression for changes to dispatch, persistence, transport, or ownership.
- Prefer tests of observable behaviour (one submission after transport loss, saved files after browser close, rejected cross-project access) over tests that mirror code.
- Keep state, tokens, private URLs, and customer artifacts out of commits and bug reports.
- npm dependencies are exact and lockfile changes are reviewed. Document licences before copying upstream code (`NOTICE`, `docs/dependency-licenses.md`).
- Update `docs/status.md` and the relevant `CHANGELOG.md` with the change.

Security reports go through GitHub private vulnerability reporting; see [SECURITY.md](SECURITY.md).

````

- [ ] **Step 4: Write `AGENTS.md`**

```markdown
# Litewave contributor guidance

Litewave is a generic community project. Read README.md, docs/status.md, and docs/design/2026-09-15-original-spec.md before extending it. Application-specific assumptions belong in `examples/` or external tests.

- Use public Playwright APIs and the official MCP SDK.
- Keep CLI, MCP, and library operation behaviour shared.
- Preserve honest action outcomes and never replay an uncertain mutation automatically.
- Do not start or restart application servers. Isolated test fixtures are owned by the test suite.
- Never kill unknown browser processes or delete unknown profile locks as recovery.
- Keep tokens, customer artifacts, and local registrations out of source control.
- Run `npm run check` for every change. Run `npm run test:browser` for browser, storage, transport, or ownership changes. Qualify macOS browser changes with `LITEWAVE_TEST_HEADED=1 npm run test:browser`.
- Update docs/status.md and the CHANGELOGs with actual evidence and remaining limitations.

For Phoenix package changes, build the Node bridge and run `mix precommit` in `packages/phoenix` (compile with warnings as errors, format, credo strict, dialyzer, tests). SQL tests use only a dedicated database selected with `LITEWAVE_TEST_DATABASE_URL`. Respect the per-file Apache-2.0 attribution in `lib/litewave/introspection.ex`.
````

- [ ] **Step 5: Write `examples/langelic.md`**

````markdown
# Example: a Phoenix LiveView application

Langelic, a Phoenix LiveView application that converts PDFs to EPUBs, was Litewave's first integration. Nothing in Litewave is specific to it; this page shows the shape of a real setup. Substitute your own paths and port.

## Browser access

With the application already running on its own port:

```sh
litewave init --project /path/to/langelic --upload-root /path/to/test-pdfs
litewave browser open --project /path/to/langelic
litewave doctor --project /path/to/langelic
```
````

Use a real fixture directory for `--upload-root`; uploads are limited to it. Register each worktree separately: identity is the canonical project directory, so a worktree on another port gets its own registration, profile, and runtime socket.

Sign into the application normally in the dedicated Chromium profile. No change to its dependencies, endpoint, database, or existing tooling is needed for browser access.

## Runtime tools

Add `{:litewave_phoenix, "~> 0.1", only: :dev}` to the application and restart it. Then:

```sh
litewave phoenix status --project /path/to/langelic
litewave phoenix call --project /path/to/langelic --tool get_source_location --json '{"reference":"Langelic.Repo"}'
```

The application enables evaluation and SQL in `config/dev.exs` after explicit owner approval:

```elixir
config :litewave_phoenix, allow_eval: true, allow_sql: true, repos: [Langelic.Repo]
```

`allow_eval` executes arbitrary Elixir in the app and `allow_sql` runs read-write SQL; both default to off.

## An acceptance workflow

A conversion exercise looks like: inspect existing export state, upload a fixture PDF, choose reflow without translation, wait for the preparation heading, capture the EPUB download, and inspect the file separately. Record access failures (Litewave), application failures, and output defects separately. A completed download proves file transport, not output quality.

The MCP entry is the one printed by `litewave init`: an installed Node executable and the absolute CLI path. Do not copy temporary test-runtime paths into an editor configuration.

````

- [ ] **Step 6: Generalise the crash investigation and update the architecture doc**

`docs/browser-crash-investigation.md`:
- Line 5: `without Litewave, Langelic, authentication, or the customer EPUB` → `without Litewave, any customer application, authentication, or a customer's EPUB`.
- Line 93: `An isolated Langelic test passes twenty real EPUB downloads over five launches per mode. Every retained file matches the original 4,996,954-byte artifact hash; every shutdown completes within ten seconds.` → `An isolated test against a real customer application passes twenty real EPUB downloads over five launches per mode. Every retained file matches the original artifact hash; every shutdown completes within ten seconds.`
- Line 123: `Twenty real Langelic EPUB downloads passed ... All files matched the expected 4,996,954-byte artifact hash.` → `Twenty real EPUB downloads from a customer application passed across five launches per mode using the final stock launch settings and ownership recovery. All files matched the expected artifact hash.`
- Line 125: replace the whole bullet with `- The customer application now uses a separate Chromium 151 profile. The original Chromium 153 profile was left with its original version file and lock, unmodified. The temporary authentication export was removed.`

`docs/architecture.md`, replace the `## Phoenix connection` section's first paragraph with:

```markdown
The stdio MCP bridge reaches the project's runtime directly, not through the browser worker. By default it reads `projects/<key>/runtime.json` under `LITEWAVE_HOME`, checks that the run directory and socket are owned by the current user, and connects to the Unix socket the `litewave_phoenix` application published at boot. If the descriptor is absent, or the socket refuses before anything was sent, and `phoenix.json` exists, it falls back to the authenticated loopback `/litewave/runtime` endpoint served by the optional `Litewave` Plug. Each execution carries a runtime identity and request ID; the supervised runtime tracks duplicates within that lifetime and refuses old identities after restart.
````

Also in `docs/architecture.md` `## Versions`, change `publication and package namespace checks remain pending` to `published as npm \`litewave\` and Hex \`litewave_phoenix\``.

- [ ] **Step 7: Check links and formatting**

Run: `npm run format && npm run format:check && grep -rn -i langelic README.md SECURITY.md CONTRIBUTING.md AGENTS.md docs/status.md docs/architecture.md docs/browser-crash-investigation.md`
Expected: prettier clean; grep prints nothing (`examples/langelic.md` and the design spec are the only places the name remains after Task 9).

Run: `for f in $(grep -oE '\]\((docs|packages|examples|src|SECURITY|CONTRIBUTING|CHANGELOG|LICENSE|NOTICE)[^)#]*' README.md CONTRIBUTING.md AGENTS.md SECURITY.md | sed 's/.*](//' | sort -u); do [ -e "$f" ] || echo "MISSING $f"; done`
Expected: only `MISSING docs/design/2026-09-15-original-spec.md` (Task 9 creates it). Anything else missing is a typo to fix now.

- [ ] **Step 8: Commit**

```bash
git add README.md SECURITY.md CONTRIBUTING.md AGENTS.md examples/langelic.md docs/architecture.md docs/browser-crash-investigation.md
git -c commit.gpgsign=false commit -m "Rewrite the root README, SECURITY, CONTRIBUTING, AGENTS and the example for the socket transport and public release"
```

---

### Task 9: Phoenix README, CHANGELOGs, capability matrix, and the design spec move

**Files:**

- Rewrite: `packages/phoenix/README.md`, `CHANGELOG.md`, `packages/phoenix/CHANGELOG.md`, `docs/status.md`
- Move and edit: `docs/spec.md` → `docs/design/2026-09-15-original-spec.md`
- Modify: `.prettierignore`

**Interfaces:**

- Consumes: Task 8's links, Task 5's module docs, Task 2/3 behaviour, Task 6/7 tooling.
- Produces: the Hex front page (`packages/phoenix/README.md`), both changelogs plan 3 will stamp with `0.1.0` and a date.

- [ ] **Step 1: Write `packages/phoenix/README.md`**

````markdown
# Litewave Phoenix

Development-only runtime tools for [Litewave](https://github.com/jtippett/litewave): `get_docs`, `get_source_location`, `get_logs`, `project_eval`, and `execute_sql_query`, published on a private Unix socket so the Litewave CLI and MCP bridge can reach your running app without a port, token, or endpoint change. Browser access is separate and optional.

## Install

```elixir
# mix.exs
{:litewave_phoenix, "~> 0.1", only: :dev}
```
````

Restart the app. Done. At boot in `:dev` the package publishes its socket under `~/.litewave` (or `LITEWAVE_HOME`). Docs, source locations, logs, and health are available immediately. From any directory:

```sh
litewave phoenix status --project /absolute/path/to/app
litewave mcp --project /absolute/path/to/app
```

To enable evaluation and SQL:

```elixir
# config/dev.exs
config :litewave_phoenix,
  allow_eval: true,
  allow_sql: true,
  repos: [MyApp.Repo]
```

`allow_eval` executes arbitrary Elixir in your application and is not a sandbox. `allow_sql` runs **read-write** SQL through the listed repositories. Both default to `false`.

Notes:

- `LITEWAVE_HOME`, if you set it, must be the same absolute path for the app and every Litewave client of the project. Keep it short (socket paths are limited to about 100 bytes on macOS) and do not point it at a symlink.
- If you include the dependency in `:test` as well (`only: [:dev, :test]`), add `config :litewave_phoenix, enabled: false` to `config/test.exs` so test runs publish nothing.
- The socket is not retried after a failure. If `litewave phoenix status` reports no runtime, run `Litewave.Listener.info()` in IEx: it reports `:disabled` with the reason, and the app keeps running regardless.

### Alternative: HTTP on the app port

If you prefer the runtime on your app's HTTP port, run `litewave init --project PATH` and then `litewave phoenix setup --project PATH`, and mount the printed `plug Litewave` line in your endpoint before `Plug.Parsers`. This transport checks loopback peer, Host, Origin, and a private Bearer token, and refuses production configuration. The socket transport needs none of that because a filesystem socket is unreachable from a web page. Options under `config :litewave_phoenix` also apply to the Plug as defaults, including `allow_eval` and `allow_sql`; the Plug's own arguments win. See `Litewave` for the Plug and `Litewave.Config` for every option.

## Tool behaviour

| Tool                    | Behaviour                                                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `phoenix_health`        | Project and runtime identity, environment, Elixir/OTP versions, enabled capabilities, repository names, transport, and the app URL when a Phoenix endpoint runs. |
| `get_docs`              | Module/function docs from installed BEAM files; supports default arities and `c:Module.callback/arity`.                                                          |
| `get_source_location`   | Module/function locations and `dep:package` paths, restricted to the project and configured dependency roots.                                                    |
| `get_logs`              | Up to 200 entries per call from a 1,024-entry buffer. Severity filter, case-insensitive literal `grep`, and cursor pagination with overflow gap detection.       |
| `project_eval`          | Opt-in Elixir execution with IEx helpers, `arguments` binding, bounded stdout, and an inspected result.                                                          |
| `execute_sql_query`     | Opt-in parameterised Ecto SQL, read-write. Requires an explicit repository when several are allowed. Returns a bounded Elixir representation of the result.      |
| `runtime_action_status` | Inspect an execution request after a lost response without dispatching it again.                                                                                 |

For evaluation and SQL, first obtain `runtime_id` from `phoenix_health`, then supply it with a caller-generated `request_id`:

```json
{
  "code": "Enum.sum(arguments)",
  "arguments": [2, 3],
  "runtime_id": "VALUE_FROM_HEALTH",
  "request_id": "sum-1"
}
```

The same request ID and arguments return the prior observation. Changed arguments under that ID are rejected. Requests are never retried automatically. A restart changes the runtime ID, so an old request cannot silently run in the replacement runtime.

Execution history is in memory, limited to 512 IDs per runtime lifetime. IDs are never evicted and reused; if the history fills, execution is refused while read-only tools continue. History is not a durable audit log. Exceptions or timeouts may follow side effects; those outcomes are reported as uncertain. Killing a timed-out task does not stop processes it spawned or undo its work.

## Configuration

All options, defaults, and bounds are documented in `Litewave.Config`. Summary:

- `enabled` (socket only): default `true`.
- `allow_eval`, `allow_sql`: default `false`. See the warnings above.
- `repos`: allowed repository modules; defaults to `:ecto_repos` of loaded applications.
- `roots`: allowed source roots; defaults to Mix dependency directories plus the project.
- `timeout`: execution time in ms, default 10,000, at most 30,000.
- `max_output_bytes`: default 64,000; 1,024 to 256,000.
- `max_rows`: SQL rows returned, default 50, at most 500.
- `project`: canonical project directory; defaults to the running Mix project.
- Plug only: `endpoint`, `token_file`, `project_id` (defaults to the project key), `environment`, or `registration:` to read the CLI's files.

## Files

Under `LITEWAVE_HOME` (default `~/.litewave`), all owner-only:

- `run/p<key16>.sock`: the runtime socket, `0600`.
- `projects/<key>/runtime.json`: descriptor with the project, key, runtime ID, OS PID, socket path, start time, and capabilities.
- `projects/<key>/phoenix.json` and `phoenix-token`: written by `litewave phoenix setup` for the HTTP transport only.

`<key>` is the first 24 hex characters of the SHA-256 of the canonical project path; see `Litewave.Paths`.

## Limits and compatibility

Elixir 1.17 or newer on OTP 27 or newer; CI runs Elixir 1.17/OTP 27 and 1.20/OTP 29 with Phoenix 1.8-era Plug and Bandit. PostgreSQL is used in tests; any Ecto SQL adapter works for SQL.

- Stdout is captured per task; `:stderr` is left with the application's device.
- Tools inspect currently loaded code and do not force a code reload.
- SQL row limits bound returned output, not database-side work.
- No production access, remote transport, automatic app repair, or persistent execution journal.
- Docs and source lookup are adapted from Tidewave Phoenix under Apache-2.0; see `NOTICE` and `LICENSE-APACHE`. Other code is MIT.

## Development

Build the Node bridge at the repository root (`npm run build`), then:

```sh
mix deps.get
mix precommit
```

`precommit` compiles with warnings as errors, checks formatting, runs credo strict and dialyzer, and runs the tests. The socket and HTTP bridge tests run the real Node bridge from `PATH` (or `LITEWAVE_NODE_EXECUTABLE`). PostgreSQL cases need a dedicated disposable database:

```sh
LITEWAVE_TEST_DATABASE_URL=postgresql://postgres@localhost/litewave_phoenix_test mix precommit
```

Without that variable the PostgreSQL cases are excluded. Never point them at a real database.

````

- [ ] **Step 2: Write the two changelogs**

`CHANGELOG.md`:

```markdown
# Changelog

All notable changes to the `litewave` npm package are documented here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The
Phoenix package has [its own changelog](packages/phoenix/CHANGELOG.md).

## [Unreleased]

Initial public release candidate.

### Added

- Persistent, dedicated Chromium profile owned by a detached worker: closing
  a CLI or MCP client leaves the browser and its login in place.
- Browser operations with one schema across CLI, library, and MCP: tabs,
  navigate, scoped accessibility snapshots, screenshots, click, fill, select,
  check, keypress, hover, upload, element waits, downloads, and `action_status`.
- Durable action journal: caller request IDs, synced intent before dispatch,
  duplicate suppression, per-tab leases, and `outcome_unknown` after a lost
  response. Uncertain mutations are never replayed.
- Allow-listed upload folders, download capture from tab creation with
  retained files and SHA-256 hashes, and restored manifests after a restart.
- Profile ownership: rejection of occupied or newer-version profiles,
  explicit `--fresh-profile` with optional storage-state import, and reopen
  through Litewave's own leftover lock only when the recorded owner is absent.
- Phoenix runtime tools (`phoenix_health`, `get_docs`, `get_source_location`,
  `get_logs`, `project_eval`, `execute_sql_query`, `runtime_action_status`)
  reached over a private Unix domain socket the `litewave_phoenix` dependency
  publishes at boot; the bridge finds it from the project directory alone.
- Fallback to the authenticated HTTP Plug transport when a stale runtime
  descriptor's socket refuses before anything was sent.
- `litewave init` reads the application URL from a running runtime when
  `--app` is omitted.
- `litewave mcp`, `litewave phoenix status`, and `litewave phoenix call` work
  without a browser registration; the MCP server always advertises the
  runtime tools and reports `not_registered` for the browser tool until
  `litewave init` runs.
- `litewave browser install` downloads the pinned Chromium build explicitly.
- `doctor` probes the Phoenix runtime alongside the app and the worker.
- Health reports `transport` and `app_url`.
- oxlint in `npm run check`; `prepublishOnly` runs the full check.

### Changed

- Runtime identity is the project key (SHA-256 of the canonical project path)
  on both transports; the `project_id` field carries it.
- The endpoint Plug is the alternative transport; the socket is the default.
- Playwright 1.62.0 / Chromium 151.0.7922.34 pinned to avoid a reproduced
  Chromium 153/154 crash on restart with retained downloads.
- Node `>=24.21.0` (Node 26 supported). The package is no longer private.
````

`packages/phoenix/CHANGELOG.md`:

```markdown
# Changelog

All notable changes to `litewave_phoenix` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

Initial public release candidate.

### Added

- Boot-time runtime publication on a private Unix domain socket under
  `LITEWAVE_HOME` (`Litewave.Listener`), with owner-only directories, a
  `0600` socket, an atomically written `runtime.json` descriptor, and
  never-crash-the-host failure handling. Disable with
  `config :litewave_phoenix, enabled: false`.
- Runtime tools: `get_docs`, `get_source_location`, `get_logs`,
  `project_eval` (opt-in), `execute_sql_query` (opt-in, read-write), plus
  health and `runtime_action_status`, with runtime identity and request-ID
  deduplication so a lost response is never replayed.
- Configuration under `config :litewave_phoenix` (`allow_eval`, `allow_sql`,
  `repos`, `roots`, `timeout`, `max_output_bytes`, `max_rows`, `project`),
  applying to the socket transport and as defaults for the `Litewave` Plug.
- Health reports `transport` (`socket` or `endpoint`) and `app_url` when a
  Phoenix endpoint process is running.
- Bandit as a runtime dependency for the socket server.
- ex_doc documentation, credo, and dialyzer in the `precommit` gate.

### Changed

- Runtime identity is the project key derived from the canonical project
  path on both transports; `project_id` for the Plug is optional and defaults
  to it.
- The endpoint Plug is the alternative transport; the socket is the default.
- The Plug refuses `production` at `init/1` and reads the host Mix
  environment, not the dependency's compile environment.
```

- [ ] **Step 3: Write `docs/status.md`**

```markdown
# Capability matrix

What Litewave does today and what remains. Evidence is the test suites named
at the bottom; nothing here is a production reliability claim.

| Area               | Implemented                                                                                                                                             | Not yet                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Setup              | Canonical project registration, CLI help, generated MCP config, exact lockfile, explicit Chromium install                                               | Registration-update command, installer/uninstaller                                                     |
| Browser ownership  | Detached worker, persistent dedicated Chromium, verified local token, explicit stop, newer-profile rejection, fresh-profile replacement, bounded reopen | Heartbeats, automatic worker recovery, sleep/resume qualification                                      |
| Browser operations | Tabs, navigation, scoped accessibility snapshots, screenshots, click/fill/select/check/keypress/hover/upload, element waits                             | Tab create/close, snapshot refs and cursors, frames, drag/scroll, dialogs, URL/download postconditions |
| Journal            | Synced intent, stable IDs and hashes, duplicate suppression, per-tab leases, conservative unknown outcomes, crash injection during a download           | Crash injection at every transition, disk-full injection, leases across all operations, cancellation   |
| Files              | Allow-listed uploads, preinstalled download listeners, unique retained paths, hashes, restored manifests, interrupted-save reporting, password masks    | Download handles and cancellation, complete failure matrix, content-length anomalies                   |
| Evidence           | Local screenshots and download manifests                                                                                                                | Evidence bundles, console/network capture and redaction, budgets and cleanup                           |
| Phoenix runtime    | Boot-time Unix socket transport, alternative authenticated HTTP Plug, seven tools, app-env configuration, runtime identity and execution deduplication  | Enforced read-only SQL, durable execution history, stderr capture                                      |
| Platforms          | macOS                                                                                                                                                   | Linux (CI only), Windows                                                                               |

## How it is verified

- `npm run check`: formatting, lint, type checking, unit and contract tests
  (storage, journal, profile ownership, runtime paths, socket and HTTP
  transports, CLI runtime commands, package contents).
- `npm run test:browser` (headless and `LITEWAVE_TEST_HEADED=1`): a
  deterministic local fixture through the real worker and MCP SDK, including
  repeated MCP reconnects, browser restarts, occupied-profile rejection,
  upload through a real file input, screenshots, download retention across a
  browser close, a dropped response followed by a request-ID reuse with
  exactly one server submission, and a native crash during a download.
- `mix precommit` in `packages/phoenix`: compile with warnings as errors,
  format, credo strict, dialyzer, and tests covering the listener (stale and
  live sockets, permissions, partial starts), the Plug's authentication,
  identity, tools, execution deduplication, timeouts, log capture, and the
  real Node bridge over both transports. PostgreSQL cases run when
  `LITEWAVE_TEST_DATABASE_URL` is set.

The browser pin and the crash it avoids are documented in
[the investigation](browser-crash-investigation.md). The downloaded test
fixture has an `.epub` name but contains deterministic bytes: these suites
prove file transport, not EPUB validity.
```

- [ ] **Step 4: Move and edit the design spec**

```bash
mkdir -p docs/design
git mv docs/spec.md docs/design/2026-09-15-original-spec.md
```

Edit `docs/design/2026-09-15-original-spec.md`:

- Line 3: replace the whole status line with `Status: original build specification, 15 September 2026, preserved as design history. The implemented behaviour is described in the repository README and docs/status.md; where they differ, they are authoritative.`
- Line 9: `The first acceptance exercise is Langelic's PDF-to-EPUB conversion` → `The first acceptance exercise is a customer's PDF-to-EPUB conversion`.
- Section 2: replace the first paragraph with `The project was motivated by an evaluation session in which the application under test responded on its port while the vendor's browser control was unavailable. Vendor login interrupted the task; session IDs disappeared after navigation and reconnection; control disconnected during an export click. Reopening the control page sometimes helped and later did not; two new-session requests returned no connected browser.` Replace `We could operate the file input only by constructing` with `The file input could be operated only by constructing`.
- Line 38: `Langelic worktree identity` → `per-worktree identity`.
- Line 197: `When implementing HTTP calls in Langelic or its Elixir integration` → `When implementing HTTP calls in a customer application or its Elixir integration`.
- Line 232: `Separately run the real Langelic workflow` → `Separately run a real customer workflow`.
- Line 234: `### Langelic product-quality exercise` → `### Customer product-quality exercise`.
- Delete section 15 (`## 15. Resume the current evaluation` through the end of the file).

Update `.prettierignore`: `docs/spec.md` → `docs/design/2026-09-15-original-spec.md`.

Run: `grep -rn "docs/spec.md" --include=*.md --include=*.json --include=*.ts --include=*.ex --include=*.exs . | grep -v node_modules | grep -v superpowers`
Expected: no output. Fix any remaining reference.

- [ ] **Step 5: Verify formatting, links, and the Elixir docs build**

Run: `npm run format && npm run check`
Expected: prettier clean (the README tables are reformatted by `format`), lint clean, 18 tests pass.

Run: `(cd packages/phoenix && mix docs 2>&1 | grep -ci warning)`
Expected: `0` (the README is an extra; a broken module reference in it, such as a backticked module that does not exist, would warn here).

Run: `grep -rn -i langelic --include=*.md . | grep -v node_modules | grep -v superpowers | grep -v "^./examples/langelic.md" | grep -v "^./docs/design/" | grep -v "^./local-feedback"`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add packages/phoenix/README.md CHANGELOG.md packages/phoenix/CHANGELOG.md docs/status.md docs/design .prettierignore
git rm --cached docs/spec.md 2>/dev/null || true
git -c commit.gpgsign=false commit -m "Phoenix README for the socket transport, Keep a Changelog entries, capability matrix, and the design spec as history"
```

---

## Self-review

**Spec coverage (section 6):**

- 6.1 ex_doc, groups, `@doc`/`@spec`, hidden modules → Task 5. credo strict and dialyxir in precommit → Task 4. `mix.exs` metadata, `docs`, `links`, `maintainers` → Task 5. `hex.build` files incl. CHANGELOG and licences → Task 5 step 1. Elixir `~> 1.17` and the CI matrix → Task 7.
- 6.2 remove `private`, repository/homepage/bugs/keywords, `prepublishOnly`, `files` review, no postinstall → Task 6. Explicit Chromium install → Task 2 (`browser install`) and Task 8 README. Lint with a `lint` script in `check` → Task 1 (oxlint, deviation recorded above).
- 6.3 Root README → Task 8. Phoenix README → Task 9. CHANGELOGs → Task 9. status.md matrix → Task 9. spec.md move and phrasing → Task 9. Langelic references → Tasks 8 and 9. AGENTS handoff removal → Task 8. CONTRIBUTING and SECURITY naming → Task 8. Crash investigation stays → Task 8 (generalised).

**Followups coverage:** transport naming, `~` in `LITEWAVE_HOME`, refused/timeout message, symlinked descriptor and home documented, `not_registered` wording, browser tool description, `http-fixture` literal, `LITEWAVE_HOME` must match, read-write SQL warning, `enabled: false` guidance, `phoenix setup` needs `init`, app-env applies to the Plug, SECURITY identity text, CHANGELOG omissions, production-host test, cli-runtime env restore, `all_loaded` flake, SocketPlug 404 envelope, partial sweep, `info/1` paths, guarded `Application.children`, descriptor dir mode test, Bandit EXIT test, listener never retries (documented). Not taken: `from_registration` wrong-key direct test (already present at `runtime_test.exs:338`); atomic probe/replace across two BEAMs and descriptor-PID check (accepted spec deviation); `mcp.ts` version (plan 3); symlinked `runtime.json` code classification (documented as refused; message unchanged).

**Placeholders:** none; every step names files, code, and expected output.

**Type consistency:** `RuntimeTarget.kind` is `"socket" | "endpoint"` in Tasks 2 and 9; `Application.children/2` in Tasks 3 and 5; `Listener.info/1` shape in Tasks 3 and 5; scripts `lint`/`check`/`prepublishOnly` in Tasks 1, 6, 7; PLT path in Tasks 4 and 7.

**Review Focus:** each of the five lines has a test in the task it names (Tasks 2, 3, 5, 6, 7).
