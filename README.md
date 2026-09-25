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
