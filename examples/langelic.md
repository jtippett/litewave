# Langelic: first customer

The browser core contains no Langelic-specific logic. Langelic remains responsible for its server, app authentication, jobs, and conversion behavior.

From the Litewave checkout, with Langelic already running:

```sh
node dist/src/cli.js init --project /Users/james/Desktop/elixir/langelic --app http://localhost:4444 --upload-root /absolute/path/to/test-pdfs
node dist/src/cli.js browser open --project /Users/james/Desktop/elixir/langelic
node dist/src/cli.js doctor --project /Users/james/Desktop/elixir/langelic
```

Use an actual fixture directory for `--upload-root`. For a Langelic worktree, register its canonical directory and assigned app port separately. Follow Langelic's own `bin/worktree-setup` instructions if creating a new worktree; do not run that setup in the main checkout.

Sign into Langelic normally in the dedicated Chromium profile. No changes to its Mix dependencies, endpoint, database, or existing Tidewave setup are required for browser access.

The real PDF-to-EPUB acceptance exercise belongs after the access release gates: inspect existing export state, upload a selected fixture, request reflow without translation, observe preparation, capture the output download, and inspect the real EPUB separately. Record access failures separately from application failures and conversion defects. A successful download alone does not establish output quality.

## Phoenix integration

Langelic now includes the local package only in development and only when its sibling Litewave checkout exists. Set `LITEWAVE_PHOENIX_PATH` when the package lives elsewhere, including when running Langelic from a worktree. Register each worktree separately before compiling its endpoint.

The development Plug resolves the registration by canonical project path, mounts before body parsing, and enables health, docs, source, logs, runtime evaluation, and writable SQL following explicit owner approval. The library itself supports both capabilities and tests them in an isolated database. Existing Tidewave remains installed.

After the application owner restarts Langelic to load the new dependency, run:

```sh
node dist/src/cli.js phoenix status --project /Users/james/Desktop/elixir/langelic
node dist/src/cli.js phoenix call --project /Users/james/Desktop/elixir/langelic --tool get_source_location --json '{"reference":"Langelic.Repo"}'
```

The MCP command remains `node /absolute/path/to/litewave/dist/src/cli.js mcp --project /absolute/path/to/langelic`. Use an installed Node 24 LTS executable for a durable editor configuration. No temporary test-runtime paths should be copied into that configuration.
