# Changelog

All notable changes to the `litewave` npm package are documented here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The
Phoenix package has [its own changelog](packages/phoenix/CHANGELOG.md).

## [Unreleased]

## [0.1.0] - 2026-09-25

Initial public release.

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
  descriptor's socket fails before anything was sent (refused, missing, or not a
  socket).
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

[Unreleased]: https://github.com/jtippett/litewave/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/jtippett/litewave/releases/tag/v0.1.0
