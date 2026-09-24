# Contributing to Litewave

Litewave is being built as a community project. Its core should work with ordinary web pages, React/Inertia, and Phoenix LiveView. Customer-specific routes, selectors, documents, and database queries belong in examples or external integration tests.

## Development

Use Node 24.21.0, then:

```sh
npm ci
npm run browser:install
npm run format
npm run check
npm run test:browser
LITEWAVE_TEST_HEADED=1 npm run test:browser
```

The browser test creates a deterministic loopback fixture server and isolated temporary profile. It starts no customer application and uses no external account. Unit tests run without a browser. macOS is the initial supported platform; Linux CI is supplemental evidence, not a claim of Linux product support.

## Phoenix development

After building the Node bridge, run `npm run test:phoenix`. Set `LITEWAVE_TEST_DATABASE_URL` to a dedicated disposable PostgreSQL database to include SQL tests. Package-specific behavior and licensing are documented in `packages/phoenix/README.md`. Run `mix precommit` in that package after Elixir changes.

## Changes and reviews

- Explain the user-visible behavior, boundaries, and validation in the PR.
- Read `docs/spec.md` and `docs/status.md` before implementing a new capability.
- Keep browser operations in the core. CLI and MCP must share the schema and implementation.
- Use public Playwright APIs. Do not import undocumented internals.
- Never replay an uncertain mutation automatically. Add a failure regression for changes to dispatch, persistence, transport, or ownership.
- Avoid tests that only mirror code. Prefer observable behavior: one submission after transport loss, saved files after browser close, rejected cross-project access.
- Keep state, tokens, private URLs, and customer artifacts out of commits and bug reports.
- Dependencies are exact and lockfile changes are reviewed. Document licenses before copying upstream code.
- Update the capability matrix with evidence. An untested requirement remains unchecked.

The initial GitHub home, maintainers, package namespace, and private vulnerability-reporting channel still need to be selected before a public release. Do not invent those addresses or publish the package without that setup.
