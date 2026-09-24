# Litewave Phoenix

Development-only runtime tools for Litewave. The adapter provides the five core Tidewave-style operations: `get_docs`, `get_source_location`, `get_logs`, `project_eval`, and `execute_sql_query`.

The CLI and MCP bridge connect directly to the adapter. Browser startup and browser authentication are independent of runtime access.

## Install from the Litewave checkout

First register your app and generate its private runtime connection from the repository root:

```sh
npm ci
npm run build
node dist/src/cli.js init --project /absolute/path/to/app --app http://localhost:4000
node dist/src/cli.js phoenix setup --project /absolute/path/to/app
```

If the app is already registered, skip `init`. Setup is idempotent and does not replace an existing token or configuration. Tokens stay in the private registration directory under `~/.litewave`; setup prints their file path, never their contents. If using `LITEWAVE_HOME`, use the same setting for the app and all Litewave clients.

Add the local Mix dependency to your app:

```elixir
{:litewave_phoenix, path: "/absolute/path/to/litewave/packages/phoenix", only: :dev}
```

Mount the Plug in your Phoenix endpoint **before `Phoenix.CodeReloader` and `Plug.Parsers`**. For the usual `lib/my_app_web/endpoint.ex` location:

```elixir
if Mix.env() == :dev do
  plug Litewave,
    registration: Path.expand("../..", __DIR__)
end
```

That enables docs, source locations, logs, and health. To explicitly enable IEx-like evaluation and Tidewave-style writable SQL, add:

```elixir
allow_eval: true,
allow_sql: true,
repos: [MyApp.Repo]
```

SQL is **read-write** when enabled. Runtime evaluation can also mutate application state or execute SQL. These capabilities are for trusted local development, and are not sandboxes. A dedicated read-only database connection is a separate future feature.

Run `mix deps.get`, then have the application owner restart the app once to load the new dependency. Litewave never starts or restarts the application server. There is no toolbar or browser control page to keep open.

```sh
node dist/src/cli.js phoenix status --project /absolute/path/to/app
node dist/src/cli.js phoenix call --project /absolute/path/to/app --tool get_docs --json '{"reference":"MyApp.Accounts"}'
```

The existing `litewave mcp --project ...` entry advertises the runtime tools once Phoenix setup has been run. Reconnect the agent's MCP client after initial setup. It can connect even while the app or browser is down; tools report their own availability.

## Tool behavior

| Tool                    | Behavior                                                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `phoenix_health`        | Project and runtime identity, environment, Elixir/OTP versions, enabled capabilities, and repository names.                                                    |
| `get_docs`              | Module/function docs from installed BEAM files; supports default arities and `c:Module.callback/arity`.                                                        |
| `get_source_location`   | Module/function locations and `dep:package` paths, restricted to the project and configured dependency roots.                                                  |
| `get_logs`              | Up to 200 entries per call from a 1,024-entry buffer. Severity filter, case-insensitive literal `grep`, and cursor pagination with overflow gap detection.     |
| `project_eval`          | Opt-in Elixir execution, IEx helpers, `arguments` binding, bounded stdout and inspected result.                                                                |
| `execute_sql_query`     | Opt-in parameterized Ecto SQL. Requires an explicit repository if multiple repositories are allowed. Returns a bounded Elixir representation of query results. |
| `runtime_action_status` | Inspect an execution request after a lost response without dispatching it again.                                                                               |

For evaluation and SQL, first obtain `runtime_id` from `phoenix_health`, then supply it with a caller-generated `request_id`:

```json
{
  "code": "Enum.sum(arguments)",
  "arguments": [2, 3],
  "runtime_id": "VALUE_FROM_HEALTH",
  "request_id": "sum-1"
}
```

The same request ID and arguments return the prior observation. Changed arguments under that ID are rejected. HTTP requests are never automatically retried. An app/adapter restart changes the runtime ID, so an old request cannot silently run in the replacement runtime.

Execution history is in memory, limited to 512 execution IDs per adapter lifetime. IDs are never evicted and reused; if the history fills, execution is refused while read-only tools remain available. History is not a durable audit log. A changed runtime cannot establish the outcome of an earlier execution. Exceptions or timeouts may follow side effects; those outcomes are reported as uncertain. Killing a timed-out task does not stop processes it spawned or undo work it already performed.

## Configuration

`registration:` reads the project identity and token path generated by the CLI. For explicit configuration, use `project:`, `project_id:`, `endpoint:` (loopback origin), and `token_file:`. Never put the token itself into an endpoint URL or source file.

Other options:

- `allow_eval`, `allow_sql`: default `false`.
- `repos`: allowed repository modules. By default, discovers `:ecto_repos` from loaded applications.
- `roots`: allowed dependency/source roots; defaults to Mix dependency directories, plus the project directory.
- `timeout`: maximum execution time, default 10,000 ms, configurable up to 30,000 ms.
- `max_output_bytes`: default 64,000; configurable between 1,024 and 256,000.
- `max_rows`: SQL output row limit, default 50, configurable up to 500.

The Plug validates loopback peer address, exact Host and Origin, and the token before reading a request body. It refuses production configuration. It handles only `/litewave/runtime` and preserves normal app responses. The HTTP endpoint uses Litewave's private JSON protocol; the supported MCP transport is the Node bridge's stdio connection.

## Limits and compatibility

Tested locally with Elixir 1.20.4, OTP 29, Phoenix 1.8.x as the customer integration, Plug 1.20.3, and PostgreSQL. CI configuration also checks the package independently of Langelic.

- Stdout is captured per task; global `:stderr` is left with the application's existing device.
- Tools inspect currently loaded code. This adapter does not force an application code reload; normal Phoenix development requests trigger the app's configured reloader.
- SQL row limits bound returned output, not database-side work or memory allocated before truncation. The timeout is the Ecto/driver/task timeout, not a dedicated server-side read-only transaction.
- No production access, remote transport, automatic app repair, or persistent execution journal is supplied.
- Docs/source lookup is adapted from Tidewave Phoenix under Apache-2.0; see `NOTICE` and `LICENSE-APACHE`. Other original package code is MIT.

## Development checks

Build the Node bridge at the repository root, then run:

```sh
mix deps.get
mix precommit
```

The real HTTP/MCP test uses Node from `PATH`, or `LITEWAVE_NODE_EXECUTABLE`. PostgreSQL cases require a dedicated test database:

```sh
LITEWAVE_TEST_DATABASE_URL=postgresql://postgres@localhost/litewave_phoenix_test mix precommit
```

Without that environment variable, PostgreSQL cases are explicitly excluded. Never point these tests at a customer database. Tests create only temporary SQL tables inside the selected test database; the caller owns database creation and deletion.
