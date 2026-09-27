# Changelog

All notable changes to `litewave_phoenix` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.0] - 2026-09-27

Initial public release.

### Added

- Boot-time runtime publication on a private Unix domain socket under
  `LITEWAVE_HOME` (`Litewave.Listener`; it must be the same absolute path for
  the application and every client), with owner-only directories, a
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
- A production host (`MIX_ENV=prod`, or no Mix project) starts no Litewave
  runtime children, so a release can never publish a socket.

### Changed

- Runtime identity is the project key derived from the canonical project
  path on both transports; `project_id` for the Plug is optional and defaults
  to it.
- The endpoint Plug is the alternative transport; the socket is the default.
- The Plug refuses `production` at `init/1` and reads the host Mix
  environment, not the dependency's compile environment.

[Unreleased]: https://github.com/jtippett/litewave/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/jtippett/litewave/releases/tag/v0.1.0
