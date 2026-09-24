# Litewave 0.1.0 release design: socket transport, quality sweep, and publishing

Status: approved design, 24 September 2026.
Repository: github.com/jtippett/litewave.
Packages: `litewave` on npm, `litewave_phoenix` on Hex. Both free as of this date.

## 1. Goal

Publish Litewave as a respectable community library on Hex and npm. The
release has three parts, in order:

1. A Unix-socket transport for the Phoenix runtime package, so a Phoenix
   developer installs one dependency and needs no port, token, or Plug line.
2. A quality and documentation sweep against that final install story.
3. Release engineering: package metadata, a gated publish workflow, and
   repository hygiene.

James runs the final `mix hex.publish` and `npm publish`.

## 2. Decisions already made

| Question                  | Decision                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Hex and npm relationship  | Hex package works standalone for runtime tools; the Node CLI is still required for the MCP bridge and browser. |
| Primary runtime transport | Unix domain socket published by the Elixir app at boot.                                                        |
| Endpoint Plug             | Kept as a documented alternative transport, unchanged in behaviour.                                            |
| Order of work             | Socket transport first, then sweep, then publish.                                                              |
| Repository home           | github.com/jtippett/litewave                                                                                   |
| First version             | 0.1.0 on both registries.                                                                                      |

## 3. Why a socket

Tidewave serves its tools on the application's HTTP port. That forces the
agent configuration to know the port, forces Host and Origin checks to keep
browsers away, and makes two worktrees a manual exercise. A filesystem socket
removes all three. It also lets any Mix project expose docs, source, logs,
eval, and SQL, because no Plug pipeline is needed.

## 4. Elixir package: runtime over a socket

### 4.1 Listener

In `:dev` and `:test`, `Litewave.Application` starts a Bandit listener with
`ip: {:local, socket_path}` and `port: 0`, serving the same request handler
the Plug uses. It starts after `Litewave.Logs` and `Litewave.Runtime`.

If the listener cannot start, the library logs one warning naming the cause
and continues. The library never crashes the host application.

### 4.2 Socket path

The socket path derives from the canonical project directory alone, so the
CLI computes it without reading any file:

```
$LITEWAVE_HOME/run/p<first 16 hex chars of sha256(canonical project)>.sock
```

`LITEWAVE_HOME` defaults to `~/.litewave`. The path must fit in 100 bytes,
matching the browser worker's existing check. A longer path produces the
existing "choose a shorter path" warning.

### 4.3 Descriptor

At boot the runtime writes `$LITEWAVE_HOME/projects/<key>/runtime.json`
atomically, mode 0600, in a 0700 directory it creates if absent. Fields:

```json
{
  "version": 1,
  "project": "/canonical/project/path",
  "project_id": "<24 hex chars>",
  "runtime_id": "<random>",
  "os_pid": 12345,
  "socket": "/Users/x/.litewave/run/p0123456789abcdef.sock",
  "started_at": "2026-09-24T10:00:00Z",
  "capabilities": ["get_docs", "get_source_location", "get_logs"]
}
```

The runtime removes the descriptor and socket on clean shutdown. After a
crash, the next boot finds a socket that refuses connections and whose
recorded PID is absent, and replaces both. A socket that accepts connections
is left alone and the new runtime logs a warning: two runtimes for one project
is a user error to report, not to resolve.

The runtime never creates `registration.json`. Browser access still requires
an explicit `litewave init`.

### 4.4 Identity

The runtime protocol identifies a project by canonical path and project key.
The browser registration UUID is no longer part of runtime identity. The
envelope's `project_id` field keeps its name and now carries the project key
on both transports. The Node bridge validates `project` in health responses,
as it does today, and `project_id` in every envelope. Protocol version stays
1; nothing has been published against it.

### 4.5 Authentication

On the socket, the 0700 run directory and the 0600 socket file are the
credential. There is no token. This matches the browser worker's model and
SECURITY.md's existing statement that a same-user process is trusted.
Peer-credential checks remain future hardening and are listed as such.

The Plug transport keeps its loopback, Host, Origin, and Bearer token checks
unchanged.

### 4.6 Configuration

Options move to application environment:

```elixir
# config/dev.exs
config :litewave_phoenix,
  allow_eval: true,
  allow_sql: true,
  repos: [MyApp.Repo]
```

All existing option names, defaults, and bounds are kept: `allow_eval`,
`allow_sql`, `repos`, `roots`, `timeout`, `max_output_bytes`, `max_rows`.
New: `enabled: false` disables the socket listener. The Plug continues to
accept the same options as Plug arguments, overriding application
environment.

Production detection is unchanged: `Litewave.Config.environment/0` requires
a running Mix project and refuses `:prod` for both transports.

### 4.7 Application URL discovery

Health gains an optional `app_url` field. On each health request, the
runtime looks for loaded modules implementing `Phoenix.Endpoint`, calls
`url/0` on the first one whose server is running, and reports the result.
Absent Phoenix, the field is null. The CLI uses it to default `--app` in
`init`.

### 4.8 Dependencies

Bandit becomes a normal dependency. Plug and Jason remain. `ecto_sql` stays
optional. Nothing else is added at runtime.

## 5. Node bridge

### 5.1 Connection resolution

`phoenixConnection` becomes `resolveRuntime(project)`:

1. Compute the project key and read `runtime.json`. If present and valid,
   connect over `socket` using `node:http` with `socketPath`.
2. Otherwise, if `phoenix.json` exists, use the HTTP endpoint and token as
   today.
3. Otherwise return `runtime_unavailable` with installation guidance.

Response validation, size bounds, timeouts, lost-response semantics, and
error codes are unchanged. `fetch` is replaced by a small `node:http`
wrapper because `fetch` cannot target a socket.

### 5.2 Registration optional for runtime tools

`litewave mcp --project PATH` and `litewave phoenix ...` succeed when a
registration or a runtime descriptor exists. Without a registration, browser
tools return `not_registered` and the MCP server still advertises runtime
tools. `phoenix setup` remains for the Plug transport only and says so in
its output. `phoenix status` reports the transport it used.

### 5.3 CLI

`init --app` becomes optional. When omitted, `init` queries runtime health
and uses `app_url`; if that fails, it errors with the existing message.

## 6. Quality sweep

### 6.1 Elixir package

- Add `ex_doc`. README is the front page; modules grouped as Integration
  (`Litewave`), Configuration, and Internal.
- `@doc` and `@spec` on every public function. Modules with `@moduledoc
false` stay hidden.
- Add `credo` (strict) and `dialyxir` to the `precommit` alias.
- `mix.exs`: `source_url`, `homepage_url`, `docs` with `main: "readme"` and
  `extras`, package `links` (GitHub, Changelog), `maintainers`.
- `mix hex.build` includes `LICENSE`, `LICENSE-APACHE`, `NOTICE`,
  `CHANGELOG.md`.
- Elixir support: `~> 1.17`. CI tests Elixir 1.17 on OTP 27 and 1.20 on
  OTP 29. If 1.17 fails and the fix is not small, raise the requirement
  rather than claim untested support.

### 6.2 npm package

- Remove `private`. Add `repository`, `homepage`, `bugs`, `keywords`,
  `prepublishOnly: npm run check`.
- Review `npm pack --dry-run`; `files` keeps `dist/src`, README, LICENSE,
  NOTICE, CHANGELOG, and the architecture doc.
- Chromium install remains the explicit `browser:install` command. No
  `postinstall`.
- Add `typescript-eslint` with the recommended config and a `lint` script
  in `check`.

### 6.3 Documentation

- **Root README** opens with what Litewave does and why, then installs the
  CLI (`npm install -g litewave` or `npx litewave`) and the Phoenix package,
  then one worked browser example, then links to guides. Caveats move below
  the fold into a "Status" section.
- **Phoenix README** becomes: add the dependency, restart, done. The Plug
  is an "Alternative: HTTP on the app port" section.
- **CHANGELOG.md** at root and in the package, Keep a Changelog format,
  starting at 0.1.0. Dated entries from `docs/status.md` move here.
- **docs/status.md** becomes a plain capability matrix with no dates or
  customer figures.
- **docs/spec.md** moves to `docs/design/2026-09-15-original-spec.md` with
  first-person and evaluation-session phrasing removed.
- Every Langelic reference in README, CONTRIBUTING, AGENTS, and status moves
  to `examples/langelic.md`, which drops local absolute paths.
- AGENTS.md loses the "Development handoff" section.
- CONTRIBUTING and SECURITY name the repository, maintainer, and GitHub
  private vulnerability reporting.
- The Tidewave upgrade gate document stays under `docs/`.

## 7. Release engineering

- `.github/workflows/release.yml`: on tag `v*`, run both suites, then a
  `publish` job in a `release` environment with required reviewer approval,
  publishing npm with provenance and Hex with `HEX_API_KEY`.
- Dependabot for npm, Hex, and GitHub Actions, weekly.
- Issue templates (bug, feature), pull request template, CODEOWNERS.
- Enable GitHub private vulnerability reporting; SECURITY.md links to it.

## 8. Testing

Elixir, under a temporary short `LITEWAVE_HOME`:

- Listener creates socket and descriptor; health answers over the socket.
- A stale socket with a dead PID is replaced at boot.
- A live socket is left alone and a warning is logged.
- A too-long path warns and the application still starts.
- A production host starts no listener.
- Plug transport still passes its existing tests.

Node:

- Runtime call over a fixture socket, including the 1 MiB bound.
- Fallback to `phoenix.json` HTTP when no descriptor exists.
- MCP advertises runtime tools without a browser registration.
- `init` without `--app` uses `app_url` from health.
- The Phoenix bridge integration test runs over the socket and keeps one
  Plug case.

## 9. Out of scope for 0.1.0

Windows, peer-credential checks, read-only SQL enforcement, a
`litewave phoenix list` command, Linux as a supported platform. Each is
named as future work in the docs.
