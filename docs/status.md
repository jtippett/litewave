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
