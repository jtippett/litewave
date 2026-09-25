# Contributing to Litewave

Litewave is a community project hosted at <https://github.com/jtippett/litewave>, maintained by James Tippett (`@jtippett`). Its core must work with ordinary web pages, React/Inertia, and Phoenix LiveView. Application-specific routes, selectors, and queries belong in `examples/` or in external integration tests, never in the core.

## Development

Use Node 24.21.0 (`.nvmrc`), then:

```sh
npm ci
npm run browser:install
npm run check              # prettier, oxlint, build, unit and contract tests
npm run test:browser       # real Chromium against a local fixture app
LITEWAVE_TEST_HEADED=1 npm run test:browser
```

The browser suite runs a deterministic loopback fixture server with an isolated temporary profile. It starts no external application and uses no account. Unit tests run without a browser. macOS is the supported platform; Linux CI is supplemental evidence.

## Phoenix package

Build the Node bridge first (`npm run build`), then:

```sh
cd packages/phoenix
mix deps.get
mix precommit              # compile --warnings-as-errors, format, credo --strict, dialyzer, test
```

Set `LITEWAVE_TEST_DATABASE_URL` to a dedicated disposable PostgreSQL database to include the SQL tests; without it they are excluded. Never point them at a real database. CI runs Elixir 1.17 on OTP 27 and Elixir 1.20 on OTP 29.

## Changes and reviews

- Explain the user-visible behaviour, its boundaries, and how you validated it in the pull request.
- Read `docs/status.md` (capability matrix) and, for background, `docs/design/2026-09-15-original-spec.md` before adding a capability.
- Browser operations live in the core. CLI and MCP share the schema and implementation.
- Use public Playwright APIs and the official MCP SDK. Do not import undocumented internals.
- Never replay an uncertain mutation automatically. Add a failure regression for changes to dispatch, persistence, transport, or ownership.
- Prefer tests of observable behaviour (one submission after transport loss, saved files after browser close, rejected cross-project access) over tests that mirror code.
- Keep state, tokens, private URLs, and customer artifacts out of commits and bug reports.
- npm dependencies are exact and lockfile changes are reviewed. Document licences before copying upstream code (`NOTICE`, `docs/dependency-licenses.md`).
- Update `docs/status.md` and the relevant `CHANGELOG.md` with the change.

Security reports go through GitHub private vulnerability reporting; see [SECURITY.md](SECURITY.md).
