# Security model

Litewave grants substantial control over a local browser. Treat access to the CLI/MCP connection as access to the selected application's authenticated session.

The alpha uses a user-owned Unix socket, a registration secret, and private profile/journal/artifact directories. Tokens are passed only over the local socket, not in command arguments or MCP output. Native peer-credential checks are not yet implemented. A process running as the same OS user can access this state; Litewave is not a sandbox against that user.

Agent navigation is restricted to configured origins. This is not a network firewall: subresources can contact other hosts, and a person can navigate manually. Service workers are disabled in the alpha to keep Playwright navigation interception effective. Cookies are never copied from an everyday browser. Page evaluation is unsupported.

Upload paths are canonicalized and checked against upload roots. This does not defend against a malicious same-user process racing filesystem changes. Download names are sanitized and placed in unique owned directories. Screenshots mask password inputs, but other page content can be private. Review artifacts before sharing them. Litewave never uploads artifacts automatically.

The Phoenix adapter additionally checks loopback peer, Host, Origin, project identity, and a private token. Evaluation and SQL are disabled by default; enabling either grants write-capable runtime access. SQL parity is read-write and evaluation is not a sandbox.

This alpha does not yet implement diagnostic retention, capture budgets, a complete local threat-model test suite, or a durable Phoenix execution audit log. Files persist until you explicitly delete them. Stop the corresponding worker before manually deleting its registration. Completed downloads may be valuable; inspect the directory first.

Before public release, maintainers must enable and document a private vulnerability-reporting channel. Until then, do not post credentials or sensitive reproductions in public issues.
