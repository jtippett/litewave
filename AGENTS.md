# Litewave contributor guidance

Litewave is a generic community project. Read README.md, docs/spec.md, and docs/status.md before extending it. Langelic is an integration customer; keep its assumptions in examples or external tests.

- Use public Playwright APIs and the official MCP SDK.
- Keep CLI, MCP, and library operation behavior shared.
- Preserve honest action outcomes and never replay an uncertain mutation automatically.
- Do not start or restart customer application servers. Isolated test fixtures are owned by the test suite.
- Never kill unknown browser processes or delete unknown profile locks as recovery.
- Keep tokens, customer artifacts, and local registrations out of source control.
- Run `npm run check` for every change. Run `npm run test:browser` for browser, storage, transport, or ownership changes. Qualify macOS browser changes with `LITEWAVE_TEST_HEADED=1 npm run test:browser`.
- Update docs/status.md with the actual evidence and remaining limitations. Passing a fixture does not prove customer conversion quality.

For Phoenix package changes, run `mix precommit` in `packages/phoenix` after building the Node bridge. SQL tests use only a dedicated database selected with `LITEWAVE_TEST_DATABASE_URL`. Respect per-file Apache-2.0 attribution in the upstream-derived introspection module.

## Development handoff

Use this checkout for Litewave development; the sibling Langelic checkout is for customer application work. Latest private customer feedback is in `local-feedback/langelic/litewave_notes.md`, with `browser_crash.yml` and `browser-crash-investigation/` alongside it. This directory is Git-ignored: do not publish customer evidence. Langelic product findings remain in `../langelic/langelic_notes.md`.
