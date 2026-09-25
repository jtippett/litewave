# Security model

Litewave grants substantial control over a local browser and, with the Phoenix package, over a running development application. Treat access to the CLI or MCP connection as access to the application's authenticated session, and treat `allow_eval` and `allow_sql` as code execution in your app.

## Boundaries

**Same user, same machine.** State lives under `~/.litewave` (or `LITEWAVE_HOME`) with owner-only permissions. A process running as the same OS user can read it; Litewave is not a sandbox against that user. Native peer-credential checks are not implemented.

**Browser worker.** The CLI and MCP bridge reach the browser worker over a user-owned Unix socket with a registration secret that is passed only over that socket, never in command arguments or MCP output. Agent navigation is restricted to the registered origins. This is not a network firewall: subresources can contact other hosts and a person can navigate manually. Cookies are never copied from an everyday browser. Page evaluation is not exposed.

**Phoenix runtime, socket transport (default).** At boot in `:dev` the app publishes `runtime.json` and a Unix socket under `LITEWAVE_HOME`. Identity is the project key, the SHA-256 of the canonical project path. Every directory from the home down is created `0700` and must be owned by the current user; the socket is `0600`. The Node bridge checks the run directory and socket ownership before connecting. No token is used: a filesystem socket is unreachable from a web page, so the Host/Origin/token checks of the HTTP transport are unnecessary. Only a socket that refuses connections is ever replaced; a live one is reported, never removed.

**Phoenix runtime, HTTP transport (alternative).** The `Litewave` Plug accepts only loopback peers with the exact configured Host, an absent or exact Origin, and a Bearer token read from a private (`0600`, owned) file. It refuses production configuration at startup and never follows redirects.

**Execution.** `project_eval` runs arbitrary Elixir in the application. `execute_sql_query` runs **read-write** SQL through the configured Ecto repositories. Both are off by default and, when enabled, grant write-capable access to whoever can reach the socket. Execution history is in memory and is not an audit log.

**Files.** Upload paths are canonicalised and checked against the allowed roots; this does not defend against a malicious same-user process racing filesystem changes. Downloads get sanitised names in unique owned directories. Screenshots mask password inputs, but other page content can be private. Review artifacts before sharing them; Litewave never uploads them.

## Not yet implemented

Diagnostic retention limits, capture budgets, a complete local threat-model test suite, and a durable Phoenix execution audit log. Files persist until you delete them. Stop the worker before removing a registration by hand.

## Reporting a vulnerability

Report privately through GitHub: <https://github.com/jtippett/litewave/security/advisories/new>. The maintainer is James Tippett (`@jtippett`). Please do not open public issues for security reports and do not include credentials or customer data in reproductions. Expect an acknowledgement within a week.
