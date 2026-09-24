# Implementation status

This file records the development alpha's scope. The original specification is a target, not a list of implemented promises.

| Area                | Implemented                                                                                                                                         | Remaining release gates                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Setup               | Canonical project registration, CLI help, generated MCP config, exact lockfile                                                                      | Published package/name, installer/uninstaller, setup usability testing                                           |
| Browser ownership   | Detached worker, persistent dedicated Chromium, verified local token, explicit stop                                                                 | Heartbeats, bounded recovery, sleep, supervisor/worker fault suite                                               |
| Browser operations  | Tabs, navigation, scoped accessibility snapshots, screenshots, click/fill/select/check/keypress/hover/upload, element waits                         | Tab create/close, snapshot refs/cursors, frames, drag/scroll, dialogs, URL/download postconditions, cancellation |
| Journal             | Synced intent, stable IDs/hashes, duplicate suppression, per-tab leases, conservative unknown outcomes                                              | Process crash injection at every transition, disk-full injection, leases across all operations                   |
| Files               | Allowlisted uploads, preinstalled download listeners, unique retained paths, hashes, restored manifests, interrupted-save reporting, password masks | Download handles/cancellation, complete failure matrix, content-length anomalies                                 |
| Evidence            | Local screenshots and download manifests                                                                                                            | Evidence bundles, console/network capture and redaction, budgets and cleanup                                     |
| Phoenix             | Optional Mix Plug, five parity tools, authenticated HTTP bridge, registration setup, runtime identity and execution deduplication                   | Enforced read-only SQL, durable execution history, wider version matrix, stderr capture                          |
| Customer acceptance | Langelic setup example                                                                                                                              | Real PDF-to-EPUB workflow and output-quality evaluation                                                          |

## Automated acceptance exercise

`npm run test:browser` runs a deterministic local HTML fixture through the real worker and MCP SDK. `LITEWAVE_TEST_HEADED=1` uses visible Chromium.

- Disconnect/reconnect 20 actual MCP processes and verify the same session.
- Confirm cookie-backed fixture login survives those reconnects.
- Reject an occupied persistent profile without terminating its owner.
- Select a local file through the real file input and observe the filename.
- Save a viewport screenshot and verify PNG dimensions.
- Reject ambiguous targets, stale revisions, disallowed navigation, and invalid tokens.
- Reject a competing tab mutation while a postcondition is pending.
- Drop a response after sending a submission, then reuse the request ID and verify a single server submission.
- Save and hash a download; close the browser and verify the file remains.

The downloaded fixture has an `.epub` filename but deliberately contains plain deterministic test bytes. It tests file transport, **not EPUB validity**. These checks do not yet establish all stage-one or later release gates. In particular, ten repeated workflow runs, vendor-outage isolation, worker-death recovery, and full file-failure coverage remain to be qualified. No latency percentile has been claimed.

## Local verification — 15 September 2026

Reference machine: macOS 26.6.2, Apple Silicon arm64; Node 24.21.0; Playwright 1.63.0; full Chromium 153.0.8010.12 (revision 1243).

- `npm run check`: formatting, type checking, and six unit/contract tests pass.
- `npm run test:browser`: full Chromium in headless mode passes.
- `LITEWAVE_TEST_HEADED=1 npm run test:browser`: visible Chromium passes. Each integration run restarts the real MCP bridge 20 times.
- `npm pack --dry-run`: package inventory checked; tests and the supplied customer specification are excluded from the npm artifact. Nothing published.
- Read-only Langelic smoke: existing application returned HTTP 200; Litewave navigated, obtained a 6,237-character accessibility snapshot, and captured a 1280×800 screenshot. Temporary browser/profile and private captures were cleaned up. No conversion was submitted, no dependencies changed, and no application server was restarted.

The occupied-profile test exposed that Playwright’s default headless shell could open alongside full Chromium using the same profile. The adapter now sets `channel: "chromium"` explicitly in both modes, and a second full-Chromium owner is rejected. Journal recovery starts only after profile ownership is acquired.

Qualification note: a repeated visible run stalled during teardown after the occupied-profile launch attempt and a dropped response. The final implementation checks Chromium’s existing `SingletonLock` before launching a second owner, without deleting or modifying it. Subsequent visible and headless runs passed. The cancelled fixture worker required explicit test cleanup; this is evidence for keeping full teardown/crash fault qualification as an open release gate, not a production reliability claim. The lost-response test accepts either a confirmed dispatch or an honestly unknown outcome while still asserting exactly one observed fixture submission.

## Phoenix parity milestone — 15 September 2026

Implemented the five standalone Tidewave-style runtime tools and the CLI/MCP bridge. The package defaults evaluation and SQL to disabled. SQL parity means read-write access when explicitly enabled; dedicated read-only enforcement remains separate. Source lookup is adapted from Tidewave Phoenix 0.9.0 with its Apache-2.0 license retained.

Validation covers 21 Elixir tests, including real authenticated HTTP, three Node MCP reconnects without a browser, PostgreSQL queries against an isolated test database, duplicate insert suppression, timeout recovery, source boundaries, log overflow, and runtime restart identity. Node tests additionally cover private idempotent setup, response bounds, project mismatches, rejected redirects, and absence of automatic execution retries. See the package README for exact semantics and limits.

Langelic integration now explicitly enables development-only evaluation and writable SQL following owner approval. Package defaults remain disabled.

Customer validation: Langelic’s development build compiles with the optional Plug. After the owner restarted the app with the environment fix, live CLI health and MCP validation passed. The full Langelic precommit run passed 6,135 of 6,136 executed tests; one existing 150 ms timeout assertion exceeded its wall-clock threshold. The targeted failed-test rerun passed (1 test).

Customer activation exposed a dependency-environment bug: Mix compiles dependencies under `:prod` by default even in a development host. Configuration and supervisor startup now check the running host Mix environment instead, requiring an active Mix project and rejecting production. The owner restarted with the fix and approved settings. Follow-up checks: 19 Phoenix tests pass (3 PostgreSQL cases excluded in this run), including the new production-host regression; all six Node tests pass. Live MCP calls against Langelic passed for health, docs, customer source lookup, logs, evaluation with duplicate-ID replay protection, and a parameterized SQL SELECT. Health confirms development mode and writable SQL through Langelic.Repo; no customer data was modified.

After activation, the full Langelic `mix precommit` completed successfully: 6,222 passed, 1 skipped, 69 excluded. Final Litewave `npm run check` also passed.

## Upload setup guidance — 15 September 2026

CLI help, registration output, MCP tool guidance, and README explain that upload access is optional, why allowed folders are needed, and that an existing fixture folder is sufficient. No dedicated uploads folder is required or created automatically. Browser status reports its loaded upload policy; doctor reports the registered folders and configuration path even without a browser. Upload errors distinguish no configured folders from a file outside allowed folders, preserving `path_not_allowed` and directing callers to doctor. The README documents the current manual update procedure; a registration-update command remains future work.

Validation: six Node tests pass, built CLI init/doctor checks pass without opening a browser or creating an upload folder, and headless plus visible Chromium integration tests pass (including upload boundaries and policy reporting across 20 MCP reconnects each). Customer permissions and running browser were not changed. Existing workers need an explicit browser stop/open to load new status/error code; fresh CLI doctor and reconnected MCP clients use the rebuilt guidance immediately.

## Browser restart crash investigation — 15 September 2026

A customer-data-free plain Playwright reproducer now confirms native Chromium crashes when downloads accumulate across persistent-browser close/reopen cycles. Both tested Chromium 153 patch versions fail; headless is also affected. Existing passing MCP reconnect tests keep the browser alive and do not cover this failure. See [the investigation and reproducer](browser-crash-investigation.md). This was an open reliability gate at that point; the qualified mitigation below supersedes that status.

## Browser stability mitigation — 16 September 2026

Litewave pins Playwright 1.62.0 / Chromium 151.0.7922.34 with stock launch settings to avoid the independently reproduced Chromium 153/154 download/restart crash. Newer Chromium, WebSocket transport, and staging-file changes still reproduce the native failure. See [the full investigation](browser-crash-investigation.md).

A separate intermittent shutdown stall survived the early feature and cleanup experiments. A sampled process had acknowledged close and detached its pages, but remained idle until Playwright's termination timeout. The feature override was removed. Litewave now persists verified ownership and closure, waits for bounded termination, reports slow shutdown, and permits an explicit reopen through its own leftover lock only when the recorded owner is absent and the project/profile/lock evidence matches. Unknown or live owners remain rejected. Litewave does not unlink locks. Status remains available during shutdown and tab mutations are rejected.

The browser suite includes actual restarts, login import/persistence, restored artifacts, interrupted-action deduplication, startup-conflict diagnostics, and native-crash injection during a download followed by reopening the same profile and downloading again. Empty files are valid completed artifacts. Newer-version profiles are rejected before launch; explicit fresh-profile selection and optional private storage-state import preserve the old profile. The application server is never restarted by these operations.

Broader worker-process death, sleep/resume, cancellation and disk-failure qualification remain alpha gates. The real EPUB checks establish exact file transport and browser lifecycle behavior; they do not evaluate conversion quality.

## Final verification and customer activation — 16 September 2026

- `npm run check`: nine unit/contract tests pass, with formatting and TypeScript checks.
- Headless and visible `npm run test:browser`: four acceptance/fault cases pass per mode. Each mode includes twenty actual MCP reconnects and ten browser restart cycles. Each also deliberately crashes one owned native browser and then reuses its profile successfully. There were no unexpected native download crashes.
- The final visible run included one Playwright-forced shutdown at its termination timeout; the subsequent same-profile reopen preserved login, artifacts and action identity. This is tested bounded recovery, not a claim that every Chrome exit is graceful.
- Twenty real Langelic EPUB downloads passed across five launches per mode using the final stock launch settings and ownership recovery. All files matched the expected 4,996,954-byte artifact hash.
- Customer activation then passed two more real downloads through the actual MCP SDK, separated by a full browser/worker restart. Login persisted, the first artifact remained listed, and the browser stayed ready after MCP detach.
- Langelic now uses a separate Chromium 151 profile. The original Chromium 153 profile still has its original version/lock and no file modification later than 15 September 15:58:55 UTC. The temporary authentication export was removed. Codex and Claude configurations both already point to the rebuilt CLI and Node 24 runtime; neither needed a configuration change.
- `npm pack --dry-run` checked 49 package files: no obsolete feature policy, test/customer fixtures, registration, or authentication export. Nothing was published. The application server was not restarted.

## Independent customer retest and handoff — 16 September 2026

The latest Langelic usage retest reports two successful downloads of the previously crashing EPUB through actual MCP tools, separated by an explicit stop/open. Login and download manifests persisted, previews/screenshots worked, and an ordinary missing-selector wait returned the expected typed timeout. Shutdown took about 30 seconds and reported its duration; this remains a usability issue.

Remaining customer-reported browser gaps: selection by visible label, iframe-scoped inspection/actions, viewport resizing, and clearer separation of browser versus Phoenix capabilities. A dispatched click does not establish navigation completion; agents should wait for a destination control before inspecting the new page.

Private notes and raw crash evidence now live under `local-feedback/langelic/` in this checkout (Git-ignored). Langelic conversion-quality findings and book fixtures remain in the customer checkout. Successful file transport does not establish book quality.
