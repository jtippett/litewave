# Litewave

Local browser access for coding agents. A dedicated Chromium browser stays open when a CLI or MCP client disconnects. No Litewave account, hosted relay, or model subscription is required.

**Development alpha — the feasibility slice of [the specification](docs/spec.md).** This is the start of a community project, not a feature-complete Tidewave replacement. Browser access works independently of Phoenix. The optional Phoenix adapter now provides runtime docs, source locations, logs, evaluation, and SQL. See [tested behavior and release gates](docs/status.md).

## Requirements

- macOS; Node **24.21.0 LTS**, selected by `.nvmrc` / `.node-version`.
- npm and an explicitly installed Chromium binary.
- Your application already running. Litewave never starts or restarts it.

## Run from source

```sh
npm ci
npm run browser:install
npm run build
node dist/src/cli.js init --project /absolute/path/to/app --app http://localhost:4000
node dist/src/cli.js browser open --project /absolute/path/to/app
node dist/src/cli.js status --project /absolute/path/to/app
```

The npm package is intentionally private until its name and release gates are settled. These commands run the local checkout; no global install is needed. Browser binaries are installed only by the explicit install command. Normal browser use does not contact a Litewave service.

`init` prints an MCP configuration containing the absolute Node and CLI paths. Add that entry to your agent's MCP configuration. Litewave does not edit existing agent configuration. Start the browser explicitly before attaching MCP. Sign into your app normally in the dedicated browser, then reuse that profile. This alpha initially opens a blank tab; use the URL bar or the `navigate` operation to visit the registered app.

## Qualified browser and profile transitions

Litewave pins **Playwright 1.62.0 / Chromium 151.0.7922.34** to avoid the reproduced Chromium 153/154 persistent-download restart crash. It uses the stock Playwright launch settings. Chromium can occasionally take Playwright's 30-second termination timeout to exit; Litewave reports slow shutdown and records enough ownership evidence to reopen safely afterward. See [the investigation and upgrade gate](docs/browser-crash-investigation.md).

Litewave refuses to open a profile last used by a newer Chromium. To explicitly create a compatible replacement while preserving the previous profile:

```sh
node dist/src/cli.js stop --project /absolute/path/to/app
node dist/src/cli.js browser open --project /absolute/path/to/app --fresh-profile
```

Sign in normally in the replacement. Alternatively, add `--storage-state /absolute/path/to/state.json` to import an explicitly supplied Playwright storage-state export into the fresh profile. That file contains authentication: keep it private and remove the temporary export after import. Litewave never exports authentication or imports it from another browser automatically. Subsequent normal opens reuse the selected profile. The registration, upload policy, action journal, retained downloads, and old profile remain in place; tabs and unsaved page state do not transfer.

## Phoenix runtime tools

Run `node dist/src/cli.js phoenix setup --project /absolute/path/to/app` to generate the local connection, then follow the [Phoenix package setup](packages/phoenix/README.md). Runtime tools work without an open browser. Evaluation and writable SQL require explicit app configuration.

## Use the CLI or MCP

Every browser operation uses the same schema and response envelope through the library, CLI, and MCP `browser` tool.

```sh
node dist/src/cli.js call --project /absolute/path/to/app --json '{"method":"tabs","requestId":"inspect-tabs-1"}'
```

Take a `tabId` from that result. There is no implicit selected tab.

```json
{
  "method": "navigate",
  "requestId": "navigate-home-1",
  "tabId": "TAB_ID",
  "url": "http://localhost:4000"
}
```

```json
{
  "method": "click",
  "requestId": "export-1",
  "tabId": "TAB_ID",
  "target": { "kind": "role", "role": "button", "name": "Export" },
  "postcondition": {
    "target": { "kind": "role", "role": "heading", "name": "Export ready" },
    "state": "visible"
  }
}
```

Use a new request ID for each intended mutation. **After a lost response, query `action_status` with `actionId: "export-1"`.** Sending the same operation with the same request ID returns its prior state; it does not click again. Changing parameters under an existing ID is an error. `dispatched` means the browser call completed. `postcondition_met` confirms the requested observation. `outcome_unknown` requires investigation; it does not imply the app failed.

Locators support exact role/name, test ID, and explicit CSS. Ambiguous targets fail. Supply `revision` from a snapshot to reject an action after navigation. Snapshot references, frame targets, and page evaluation are not exposed in this alpha.

### Upload folder setup

**An uploads folder is optional.** Browser uploads send local files to your app. Litewave limits file selection to folders you explicitly allow, so the agent cannot select arbitrary local files through the browser tool. Browsing, downloads, and Phoenix tools work without upload access.

Use an existing folder containing files you intend to upload, such as a fixture directory. You can create a dedicated staging folder if you prefer, but no particular folder name or location is required. Litewave does not create one or broaden access automatically. Choose a narrow folder: its subfolders are also allowed, and symlinks cannot escape the configured boundary.

For a **new** registration, add `--upload-root` to `init`; repeat it for multiple folders:

```sh
node dist/src/cli.js init --project /absolute/path/to/app --app http://localhost:4000 --upload-root /absolute/path/to/existing-fixtures
```

For an **existing** registration, run `doctor --project PATH`. Its `uploads` section shows the configured folders, their purpose, and the registration file path, even when the browser is closed. Browser `status` reports the policy loaded by its current worker.

This alpha has no registration-update command yet. To change existing upload access, finish active browser actions/downloads, run `stop --project PATH`, and edit only the `uploadRoots` array in the registration file reported by doctor. Set it to the absolute paths of the existing folders you explicitly choose (or `[]` to disable uploads). Keep the file private and leave all other fields unchanged. Then run `browser open --project PATH` to load the policy. This closes and reopens Litewave's browser, so finish work in open tabs first. Do not delete the registration or rerun `init`; neither is needed to change upload folders.

### Files and screenshots

- `upload`: provide a file-input `target` and absolute `paths` within registered upload roots. `paths: []` clears the selection. File selection does not confirm server import.
- Downloads are captured from every tab from creation, before click dispatch. Poll `downloads` for `complete`, retained `path`, size, and SHA-256. A click is not proof of a completed download. Each download has its own destination directory.
- `screenshot`: viewport by default, `fullPage: true` for the entire page, or `target` for an element. Returns a local PNG path, image dimensions, viewport, and revision. Password inputs are masked.
- `snapshot`: bounded accessibility text, optionally scoped to a target. Truncation is explicit; cursor pagination is planned.
- `wait`: a target, `state: "visible"` or `"hidden"`, and optional `timeoutMs` up to 30 seconds.

Full schemas: [src/protocol.ts](src/protocol.ts). Public library exports: [src/index.ts](src/index.ts).

## Ownership and troubleshooting

```sh
node dist/src/cli.js doctor --project /absolute/path/to/app
node dist/src/cli.js stop --project /absolute/path/to/app
```

`doctor` probes application HTTP reachability separately from worker connectivity; login is reported as unknown. `stop` explicitly closes the owned browser and worker, refusing while an action or download is active. Closing an MCP client only detaches it.

State defaults to `~/.litewave`, with owner-only permissions. Set `LITEWAVE_HOME` to a short absolute directory to relocate it. If using a custom location, pass the same environment to every CLI/MCP client; the generated MCP entry includes it. Identity uses the canonical project directory plus a generated registration ID. Each worktree gets its own registration and profile.

Unknown profile owners and unresponsive existing sockets require attention. Litewave never kills an unknown browser or unlinks profile locks. After a verified browser closes, a normal explicit open may let Chromium reacquire its own leftover lock only when the recorded project, profile, lock owner, and closed state match and that process is confirmed absent. An absent PID alone is insufficient. The alpha has no automatic recovery after worker death, heartbeat monitor, or daemon restart policy. A worker crash can lose volatile tab state. Saved downloads remain on disk and their manifests are loaded by a replacement worker. Interrupted saves are reported explicitly. A failed launch remains available through doctor until stop, preserving its specific error.

See [security](SECURITY.md), [architecture](docs/architecture.md), and the [Langelic example](examples/langelic.md).

## Contribute

Start with [CONTRIBUTING.md](CONTRIBUTING.md). Original code is [MIT licensed](LICENSE); dependency and upstream references are in [NOTICE](NOTICE). Contributions should establish general behavior using local fixtures. Langelic is the first customer, not a dependency or the product specification.
