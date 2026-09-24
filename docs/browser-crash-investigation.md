# Persistent browser download crash — 15 September 2026

## Finding

A native Chromium crash can be reproduced without Litewave, Langelic, authentication, or the customer EPUB. Start a new persistent Playwright profile, download two small text files, close the browser normally, reopen the same profile, and repeat. On this machine, visible Chromium failed on the second launch and headless Chromium on the third.

This establishes a persistent-download lifecycle failure in the tested browser/Playwright combination. It does not identify the exact C++ defect, prove which component first creates the problematic state, or establish that every Chromium build is affected. The final pin and ownership recovery are recorded below; the exact native C++ defect remains unidentified.

## Reproduce

The original failure used Playwright 1.63.0 / Chromium 153. The current checkout pins the qualified older pair, so the default diagnostic now measures that pair. Use an isolated 1.63 installation or the installed Chrome channel comparison to reproduce the affected browser. With Node 24.21.0:

```sh
DEBUG=pw:browser node test/browser-restart.repro.mjs
```

The standalone script imports only Playwright and Node libraries. It owns a loopback HTTP fixture, starts with empty temporary profiles, saves a 52-byte text file twice per browser launch, and tests three launches per profile in headless and visible modes. It verifies bytes and waits briefly after saving to detect delayed closure. Nonzero exit means the diagnostic reproduced a failure; it is intentionally separate from the ordinary passing test suite. It closes owned contexts and removes its temporary profiles and files. No customer login or profile is needed.

For comparison with an already installed Chrome:

```sh
LITEWAVE_REPRO_CHANNEL=chrome DEBUG=pw:browser node test/browser-restart.repro.mjs
```

This does not change Litewave's configured browser. Do not substitute an existing user profile into the diagnostic.

## Environment and observations

macOS 26.6.2, Apple Silicon; Playwright 1.63.0; Node 24.21.0. Pinned Chrome for Testing 153.0.8010.12 and installed Google Chrome 153.0.8010.36 both failed the clean-profile restart diagnostic: second visible launch and third headless launch in these runs. Native crash logs show SIGSEGV. The original customer reports included SIGSEGV and SIGTRAP, with 28 consecutive matching Chromium framework stack offsets below the differing top frames. Several reproduced crashes match that original stack path; others have different top stacks. Symbols are insufficient to name the faulty C++ function.

The exact customer artifact is 4,996,954 bytes, SHA-256 `b99802442fad221fb0520ef91d4a70bede46a9f02d305fcfb27a0459d6d2cbe4`. Its live response was gzip-encoded; decoded bytes matched. A local 38-byte text fixture also reproduced the profile-dependent crash, so customer document contents, size, gzip, and application response handling are not necessary triggers.

| Comparison                                                                             | Observation                                                                        |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Fresh profiles; exact EPUB; plain Playwright, request-intercepted Playwright, Litewave | All 36 downloads passed across headless/visible and fixed-length/chunked responses |
| Node 26; fresh profiles; Litewave fixture                                              | All 12 downloads passed; no evidence here that Node 24 causes the crash            |
| Fresh profiles with approved development login; real app route                         | Two downloads each passed through plain Playwright and Litewave                    |
| Full affected-profile copies; real route                                               | Plain Playwright reproduces a native crash                                         |
| Full affected-profile copy; local static fixture                                       | Visible Litewave reproduces a native crash; headless passed this particular run    |
| Copied profile with History removed                                                    | Real downloads passed                                                              |
| Copied profile with only download rows removed from History                            | Two real downloads each passed through plain Playwright and Litewave               |
| Copied profile with normalized History preserving all records                          | Still crashes; a stale SQLite journal is not a sufficient explanation              |
| Copied profile without preferences, Local State, or Sessions                           | Still crashes in separate comparisons                                              |
| Only the affected History database in a fresh profile                                  | Passes                                                                             |
| Only the affected shared_proto_db in a fresh profile                                   | Passes                                                                             |
| Both History and shared_proto_db in a fresh profile; 38-byte text fixture              | Crashes in both modes; neither database alone triggered it in the paired controls  |
| Entirely new profiles; repeated download/close/reopen lifecycle                        | Reproduces without any copied customer state, on both tested browser builds        |

The two-database result points to interaction between restored download state. Chromium's [DownloadDB implementation](https://raw.githubusercontent.com/chromium/chromium/main/components/download/database/download_db_impl.cc) stores and reloads download records through its proto database. This source context supports investigating restore/reconciliation logic; it does not establish that implementation as the faulty function.

A download can be saved successfully and then the browser can crash. Preserve a verified completed artifact in that situation, while reporting the subsequent browser failure separately. Do not retrospectively call every saved download a failure, and do not infer browser health from a saved file alone.

## Implications for Litewave

- The 20-MCP-reconnect test keeps one browser alive. It does not cover browser close/reopen with accumulated download state. The new reproducer closes that diagnostic gap and currently fails.
- Do not claim headless mode or the installed Chrome patch release as a fix: both fail the reduced lifecycle test.
- Do not automatically delete History, shared_proto_db, profile locks, or profiles. Copy-based removal was an isolation experiment, not an approved customer repair or safe general recovery policy.
- A fresh profile with reused development login passed short customer checks, but repeated download/restart cycles can recreate the problem. Profile replacement alone is not a durable fix.
- Independently confirmed Litewave issues remain: discarded download error context; missing closed-browser doctor remedy; startup hiding profile_in_use behind worker_unavailable; ordinary wait timeouts mapped to internal_error. These need their own regression coverage.
- Next: use this customer-data-free lifecycle reproducer to verify a browser/Playwright fix or narrowly tested mitigation, and add durable regression coverage before claiming reliable recovery. An upstream report can use the script and version/stack evidence; private profiles and customer artifacts are unnecessary.

## Scope and evidence handling

The owner explicitly approved reuse of the development login in disposable test profiles. The original browser profile, cookies, history, locks, and application server were not modified. Live GET downloads exercise the app's normal download analytics; no new imports or exports were submitted. Temporary browser copies were removed. Raw local logs and exploratory scripts are retained only in the customer's local investigation directory; no report or data was posted upstream.

Final verification: `npm run check` passed all six Node tests. The existing headless and visible browser acceptance suites both passed. The saved standalone restart diagnostic failed again with the native crash on visible launch two and headless launch three. This is a reproduced open defect, not a green recovery gate.

## Follow-up: newer browsers, WebSocket transport, and Tidewave

The npm registry reported Playwright 1.63.0 as latest stable, and 1.64.0-alpha-2026-09-15 as next. The prerelease was installed only under a temporary test prefix and its Chromium154.0.8037.0 downloaded into a separate temporary browser directory. It crashed on launch two in both modes. Litewave dependencies were not changed.

A WebSocket diagnostic launched the same Chromium153.0.8010.12 using the baseline launch arguments captured from the pipe test, replacing the debugging pipe with an ephemeral loopback debugging port. Playwright connected using the public connectOverCDP API. It also crashed on launch two in both modes. The [independent Windows/Edge report](https://github.com/ryo-whaletech/microsoft-edge-cdp-pipe-download-crash-repro) found this transport change effective in its environment; our Mac result does not confirm that mitigation. The related [Playwright issue42506](https://github.com/microsoft/playwright/issues/42506) was open and labelled upstream/v1.64 when checked; that label does not establish a shipped fix.

A promising temporary mitigation is the matched prior stable pair: Playwright1.62.0 / Chromium151.0.7922.34 passed20 downloads across five browser launches in each mode. Diagnostic cross-version checks: current Playwright1.63.0 with Chromium151 passed12 downloads across three launches per mode, although two teardowns required Playwright's own forced cleanup after graceful shutdown stalled. A later full log audit also found one forced teardown in the matched 1.62/151 control; the download counts alone had hidden it. Older Playwright1.62.0 with Chromium153 still crashed in visible mode; its three headless launches passed. These cross-version combinations are diagnostic controls, not recommended deployment configurations. The matched1.62/151 pair needs full Litewave/customer qualification and a longer soak before adoption. Do not open the customer's newer-version profile with an older browser as an implicit migration.

Tidewave comparison: the inspected Phoenix packages0.5.x,0.6.1 and0.9.0 load a browser client from tidewave.ai. In0.9.0, BrowserSessions and ControlSocket relay browser_eval to the connected control page. [Tidewave's browser documentation](https://tidewave.hexdocs.pm/connect.html) describes using the existing browser and sessions via /tidewave. This differs from launching and reopening a managed Playwright profile, and its application WebSocket is not a CDP debugging WebSocket. No specific native-download-crash patch was found in these packages. The complete hosted browser-client implementation was not audited, so this establishes the observed integration architecture rather than every internal behavior.

All tests used owned disposable browsers and profiles. The original customer installation, profile, and app server remain unchanged. No guarantee of crash-free execution follows from any passing version test: Litewave still needs supervised lifecycle recovery, preserved artifacts/action journals, explicit unknown outcomes, and protection against replaying uncertain mutations or looping on a failing profile.

## Initial mitigation qualification — 16 September 2026

The initial comparisons separated two symptoms. The shutdown hypothesis below was subsequently disproved by stress tests; the final implementation is recorded in the next section.

1. **Restored download state crashes Chromium 153/154.** A stable downloadsPath does not avoid it. Restoring normal profile destruction gives clean exits on Chromium 153, but the next download still crashes in both modes. Thus forced shutdown is not required to reproduce the native download failure.
2. **A profile-destruction override initially appeared to avoid shutdown stalls.** The stock Playwright launch policy disables `DestroyProfileOnBrowserClose`. Removing only that feature from the disabled list changed the matched 1.62/151 control to 20 verified downloads, ten clean exit-code-zero shutdowns, and no forced kills. Chromium's [Profile keep-alive documentation](https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/browser/profiles/keep_alive/) describes the feature's in-memory ownership behavior; this does not erase profile files.

The initial candidate pinned Playwright 1.62.0 / Chromium 151.0.7922.34 and applied that narrow launch-policy override using public Playwright options. The full disabled-feature argument is tied to this exact driver version; maintainers must requalify it when updating the dependency. No installed-Chrome fallback or runtime browser download is used. The launcher rejects a mismatched browser version and refuses to downgrade a profile created by a newer Chromium. `browser open --fresh-profile` explicitly selects a separate profile; optional `--storage-state PATH` imports only an explicitly supplied authentication export. Old profiles are retained.

Qualification before customer activation:

- Full headless and visible Litewave acceptance suites pass, including twenty MCP reconnects per mode.
- The new lifecycle suite passes ten browser launches per mode, two verified downloads per launch, persistent login, restored artifact listings, explicit storage-state import, and no replay of an interrupted submission. Shutdowns are required to finish within ten seconds; inspected normal-launch logs show clean exits rather than forced cleanup.
- An isolated Langelic test passes twenty real EPUB downloads over five launches per mode. Every retained file matches the original 4,996,954-byte artifact hash; every shutdown completes within ten seconds. It reuses the approved development login, without submitting conversions or restarting the app.
- A public-CDP native-crash injection during a slow download confirms that Litewave remains reachable, preserves a completed zero-byte file, marks the interrupted transfer as browser_closed, provides a doctor remedy, and reloads both records after an explicitly requested replacement worker. The test waits for the close event rather than a reply from the process it deliberately crashes.

Recovery changes also preserve startup profile-conflict errors through the authenticated worker handshake, classify ordinary wait timeouts correctly, and avoid labelling a browser exit during a postcondition as a timeout. Download manifests are persisted before transfer, reloaded across workers, and report interrupted or missing files explicitly. Loaded completion records retain the original hash; startup checks file presence and size, rather than claiming to rehash every historical file. Browser shutdown after a verified save does not retroactively fail that artifact.

This is a qualified avoidance of the reproduced defect, not a native Chromium patch or a guarantee against every future browser failure. Broader worker-death, sleep/resume, cancellation, and disk-failure qualification remain separate alpha gates. Before changing the browser pin, run both browser suites, the standalone restart comparison, and a real customer download check; inspect normal shutdown logs as well as exit status.

## Final implementation: pin and verified ownership recovery

The native download regression remains reproducible on Chromium 153/154 with a fixed staging directory, retained original staging files, explicit staging deletion, and WebSocket transport. Chromium 151 avoids that native crash in the repeated fixture and customer-download comparisons. The exact native C++ defect is still an upstream investigation; this project does not claim a Chromium patch.

The separate shutdown problem was **not** reliably fixed by restoring profile destruction, closing tabs first, detaching request interception, a direct CDP close, a second close request, or WebSocket disconnection. Playwright 1.62.1 ships the same Chromium binary and changes only injected page code. A stack sample of a stalled owned Chromium 151 process showed its macOS event loop idle, with the debugging pipe open. Protocol logging confirmed that Browser.close was acknowledged and page targets detached, yet the process remained alive until termination. Therefore the early clean-shutdown samples were insufficient evidence for a flag workaround. The flag override was removed.

The shipped local implementation now uses **Playwright 1.62.0 / Chromium 151.0.7922.34 with stock launch settings**. The native regression is avoided by that pin. The remaining shutdown behavior is contained by Playwright's existing 30-second termination bound and Litewave's ownership-aware reopen:

- Persist the lock owner observed after a successful browser launch, bound to project registration, exact profile path, and session identity.
- On browser closure, persist a closed observation. Explicit stop waits for both browser termination and that record; new tab actions are rejected while closing. Stop returns its duration and warns when shutdown was slow.
- A subsequent explicit open may proceed through a leftover lock only if the saved project, profile, lock owner, and closed state match and the local recorded process is absent. Chromium still performs its own ProcessSingleton arbitration. Litewave does not unlink any lock, and an absent PID without matching ownership evidence is rejected.
- Reject a live owner, mismatched/unknown lock, unreadable ownership data, or another host. Do not kill a process or reset a profile as startup recovery.
- Preserve authentication in the same compatible profile, completed artifact manifests, interrupted download failures, and the action journal. A crash does not trigger automatic replay of application actions.

The original ten-second shutdown diagnostic correctly exposed the separate problem. It was replaced by a stronger functional recovery gate: bounded termination (35-second test allowance for Playwright's 30-second timeout), followed by successful reopening of the same profile with preserved login, artifacts, and request identity. Slow exits are recorded rather than presented as graceful ones. Native-crash injection now reopens the same profile and verifies another download, rather than requiring a fresh profile after every crash. Unit coverage separately proves that unknown/dead and known/live owners remain protected, and that the availability check itself leaves the lock unchanged.

The one-time transition from a Chromium 153 profile remains explicit: keep that profile intact and use a separate Chromium 151 profile, optionally importing an approved private storage-state export. This avoids running an older browser against newer on-disk data. Future upgrades must pass the complete restart and fault suites and the real customer download check before changing the qualified version constants.

## Final verification and customer activation — 16 September 2026

- `npm run check`: nine unit/contract tests pass, with formatting and TypeScript checks.
- Headless and visible `npm run test:browser`: four acceptance/fault cases pass per mode. Each mode includes twenty actual MCP reconnects and ten browser restart cycles. Each also deliberately crashes one owned native browser and then reuses its profile successfully. There were no unexpected native download crashes.
- The final visible run included one Playwright-forced shutdown at its termination timeout; the subsequent same-profile reopen preserved login, artifacts and action identity. This is tested bounded recovery, not a claim that every Chrome exit is graceful.
- Twenty real Langelic EPUB downloads passed across five launches per mode using the final stock launch settings and ownership recovery. All files matched the expected 4,996,954-byte artifact hash.
- Customer activation then passed two more real downloads through the actual MCP SDK, separated by a full browser/worker restart. Login persisted, the first artifact remained listed, and the browser stayed ready after MCP detach.
- Langelic now uses a separate Chromium 151 profile. The original Chromium 153 profile still has its original version/lock and no file modification later than 15 September 15:58:55 UTC. The temporary authentication export was removed. Codex and Claude configurations both already point to the rebuilt CLI and Node 24 runtime; neither needed a configuration change.
- `npm pack --dry-run` checked 49 package files: no obsolete feature policy, test/customer fixtures, registration, or authentication export. Nothing was published. The application server was not restarted.
