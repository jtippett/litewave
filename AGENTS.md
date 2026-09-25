# Litewave contributor guidance

Litewave is a generic community project. Read README.md, docs/status.md, and docs/design/2026-09-15-original-spec.md before extending it. Application-specific assumptions belong in `examples/` or external tests.

- Use public Playwright APIs and the official MCP SDK.
- Keep CLI, MCP, and library operation behaviour shared.
- Preserve honest action outcomes and never replay an uncertain mutation automatically.
- Do not start or restart application servers. Isolated test fixtures are owned by the test suite.
- Never kill unknown browser processes or delete unknown profile locks as recovery.
- Keep tokens, customer artifacts, and local registrations out of source control.
- Run `npm run check` for every change. Run `npm run test:browser` for browser, storage, transport, or ownership changes. Qualify macOS browser changes with `LITEWAVE_TEST_HEADED=1 npm run test:browser`.
- Update docs/status.md and the CHANGELOGs with actual evidence and remaining limitations.

For Phoenix package changes, build the Node bridge and run `mix precommit` in `packages/phoenix` (compile with warnings as errors, format, credo strict, dialyzer, tests). SQL tests use only a dedicated database selected with `LITEWAVE_TEST_DATABASE_URL`. Respect the per-file Apache-2.0 attribution in `lib/litewave/introspection.ex`.
