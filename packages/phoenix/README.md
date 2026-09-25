# Litewave Phoenix

Development-only runtime tools for [Litewave](https://github.com/jtippett/litewave): `get_docs`, `get_source_location`, `get_logs`, `project_eval`, and `execute_sql_query`, published on a private Unix socket so the Litewave CLI and MCP bridge can reach your running app without a port, token, or endpoint change. Browser access is separate and optional.

## Install

```elixir
# mix.exs
{:litewave_phoenix, "~> 0.1", only: :dev}
```

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
