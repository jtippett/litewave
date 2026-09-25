# Example: a Phoenix LiveView application

Langelic, a Phoenix LiveView application that converts PDFs to EPUBs, was Litewave's first integration. Nothing in Litewave is specific to it; this page shows the shape of a real setup. Substitute your own paths and port.

## Browser access

With the application already running on its own port:

```sh
litewave init --project /path/to/langelic --app http://localhost:4000 --upload-root /path/to/test-pdfs
litewave browser open --project /path/to/langelic
litewave doctor --project /path/to/langelic
```

`--app` may be omitted once the runtime tools below are installed and the application is running; `init` then reads the URL from the runtime. Use a real fixture directory for `--upload-root`; uploads are limited to it. Register each worktree separately: identity is the canonical project directory, so a worktree on another port gets its own registration, profile, and runtime socket.

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

`allow_eval: true` executes arbitrary Elixir in your application; it is not a sandbox. `allow_sql` runs read-write SQL. Both default to off.

## An acceptance workflow

A conversion exercise looks like: inspect existing export state, upload a fixture PDF, choose reflow without translation, wait for the preparation heading, capture the EPUB download, and inspect the file separately. Record access failures (Litewave), application failures, and output defects separately. A completed download proves file transport, not output quality.

The MCP entry is the one printed by `litewave init`: an installed Node executable and the absolute CLI path. Do not copy temporary test-runtime paths into an editor configuration.
