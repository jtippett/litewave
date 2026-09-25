# Release Engineering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the first public release of `litewave` (npm) and `litewave_phoenix` (Hex) at version 0.1.0 reproducible and gated: one shared `v0.1.0` tag, a release workflow that re-verifies both packages and publishes only after approval, dependency automation, and the repository hygiene files a community project is expected to carry.

**Architecture:** Versions live in exactly two files (`package.json`, `packages/phoenix/mix.exs`) and move in lockstep under one git tag; everything else derives from them (`src/mcp.ts` reads `package.json`, ex_doc's `source_ref` reads `@version`, the release workflow compares the tag to both). `.github/workflows/release.yml` runs on `v*` tags, re-runs both suites, checks tag/version/changelog agreement with `scripts/release-check.sh`, and hands off to a `publish` job bound to a GitHub `release` environment whose required reviewer is James. Dependabot, issue forms, a PR template and CODEOWNERS complete section 7 of the spec.

**Tech Stack:** GitHub Actions (`actions/checkout@v4`, `actions/setup-node@v4`, `erlef/setup-beam@v1`, `actions/cache@v4`, `gh` CLI), npm 11 (`npm publish --provenance`), Hex (`mix hex.publish`, `mix hex.audit`), Dependabot v2, bash, Node test runner, ExUnit.

**Spec:** `docs/superpowers/specs/2026-09-24-hex-npm-release-design.md`, section 7 (Release engineering) plus the carry-overs recorded at the end of the quality sweep (see "Decisions beyond spec").

## Global Constraints

- Package names: npm `litewave`, Hex `litewave_phoenix`. Both versions become `0.1.0` in this plan and stay equal; the shared git tag is `v0.1.0`. No other version string may exist in `src/`, `packages/phoenix/lib/`, or the workflows.
- Node engines stay `>=24.21.0`; Elixir stays `~> 1.17`; CI matrices stay Node 24.21.0/26 on macOS/Ubuntu and Elixir 1.17.3/OTP 27, 1.20.4/OTP 29.
- No `postinstall` script. Chromium is installed only by `litewave browser install`.
- npm dependencies stay exact (`.npmrc` `save-exact=true`); Dependabot must bump pins in place (`versioning-strategy: increase`).
- npm publishes with provenance (`--provenance --access public`); Hex publishes with `HEX_API_KEY`. Both happen only in the `publish` job, only in the `release` environment, only after both verification jobs pass.
- This plan creates **no git tag** and pushes nothing. James creates the GitHub repository, environment, secrets and the `v0.1.0` tag (checklist at the end).
- Every task ends with `npm run check` green (Node) and, when `packages/phoenix` changed, `(cd packages/phoenix && mix precommit)` green, with pristine output.
- Commits use `git -c commit.gpgsign=false commit` (agents have no signing key). Work on branch `release-engineering` in place; no worktree.
- Documentation wording: `allow_eval`/`allow_sql` remain "not a sandbox" / "read-write" wherever mentioned; Linux is "runs in CI, not a supported platform"; no customer names outside `examples/langelic.md` and `docs/design/`.

## Decisions beyond spec

Carried over from the quality sweep's final review and ruled here:

1. **`src/mcp.ts` version** is read from `package.json` at runtime through `createRequire` (new `src/version.ts`), so a bump cannot miss it. Tested.
2. **Source maps are not shipped.** `tsconfig.json` keeps `sourceMap: true` for local debugging; `package.json` `files` excludes `dist/src/**/*.map`. Shipping maps that point at absent `src/` files helps nobody; inlining sources would ship the TypeScript. Tested by the pack test.
3. **`mint` advisory EEF-CVE-2026-82672** (test-only, transitive via `req`/`finch`): `mix deps.update mint` to 1.10.1, and `mix hex.audit` becomes a CI step (not part of `precommit`, which must work offline).
4. **Hex packaging in CI:** `MIX_ENV=dev mix docs --warnings-as-errors` and `MIX_ENV=dev mix hex.build` run in the `phoenix` CI job, closing the quality sweep's Review Focus #5 gap. The `phoenix` job timeout rises from 20 to 30 minutes for cold dialyzer builds.
5. **One tag for both packages.** The two versions move together; a Hex-only or npm-only fix still bumps both. Simpler than two tag namespaces for a two-package repository maintained by one person.
6. **Release notes** come from the root `CHANGELOG.md` section for the tag; the workflow refuses a tag whose section is missing in either changelog.
7. **npm authentication** uses an `NPM_TOKEN` granular access token (publish, 2FA bypass) as `NODE_AUTH_TOKEN`; provenance still comes from the job's OIDC token (`id-token: write`). Switching to npm trusted publishing later is a one-line change documented in CONTRIBUTING.
8. **`src/profile.ts` driver-mismatch message** gets the same installed-user wording fix `src/browser.ts` received in the sweep.
9. **Changelog dates** are the date the release commit is made (`2026-09-25`); if James publishes on a later day he edits the date in the release commit before tagging. Both changelogs keep an empty `## [Unreleased]` above the release section.

## Review Focus

Behaviours the spec implies but no existing test pins. Each line names the task that adds its test.

1. A tag whose version differs from `package.json`, `mix.exs`, or either changelog must fail before anything is published. → Task 4 (`scripts/release-check.sh` with `test/release-check.test.ts`).
2. The MCP server must report the package's real version, so a client never sees `0.1.0` against a `0.1.1` package. → Task 1 (`test/version.test.ts`).
3. The npm tarball must contain no `.map` files and no `scripts/` directory. → Task 1 (`test/package.test.ts`).
4. `package.json` and `mix.exs` must carry the same version string. → Task 1 (`test/package.test.ts`).
5. `mix hex.build` must keep shipping `CHANGELOG.md`, both licences and `NOTICE`, and `mix docs` must build warning-free, on every push. → Task 3 (CI steps; there is no unit test for a Hex tarball, so the CI step is the pin).

---

## File structure

| File                                                                                                                                     | Responsibility                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/version.ts` (new)                                                                                                                   | Exposes `packageVersion` read from `package.json` at runtime.                   |
| `src/mcp.ts`                                                                                                                             | Uses `packageVersion` instead of a literal.                                     |
| `src/profile.ts`                                                                                                                         | Installed-user wording for the driver-mismatch message.                         |
| `package.json`, `package-lock.json`                                                                                                      | Version `0.1.0`; `files` excludes source maps.                                  |
| `packages/phoenix/mix.exs`, `mix.lock`                                                                                                   | Version `0.1.0`; `mint` 1.10.1.                                                 |
| `CHANGELOG.md`, `packages/phoenix/CHANGELOG.md`                                                                                          | `[0.1.0] - 2026-09-25` sections with compare links.                             |
| `test/version.test.ts` (new), `test/package.test.ts`, `test/release-check.test.ts` (new)                                                 | Pins for Review Focus 2, 3, 4, 1.                                               |
| `scripts/release-check.sh` (new)                                                                                                         | Tag / version / changelog agreement; used by the release workflow and its test. |
| `.github/workflows/ci.yml`                                                                                                               | Hex packaging steps, `hex.audit`, timeout 30.                                   |
| `.github/workflows/release.yml` (new)                                                                                                    | Tag-driven verify → approve → publish → GitHub release.                         |
| `.github/dependabot.yml` (new)                                                                                                           | Weekly npm, mix, github-actions updates.                                        |
| `.github/ISSUE_TEMPLATE/{bug_report.yml,feature_request.yml,config.yml}`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/CODEOWNERS` (new) | Repository hygiene.                                                             |
| `CONTRIBUTING.md`, `docs/status.md`                                                                                                      | "Releasing" section; verification bullet for the release workflow.              |

---

### Task 1: Versions derive from two files; 0.1.0 everywhere

**Files:**

- Create: `src/version.ts`, `test/version.test.ts`
- Modify: `src/mcp.ts:11`, `src/profile.ts:25`, `package.json`, `package-lock.json`, `packages/phoenix/mix.exs:4`, `CHANGELOG.md`, `packages/phoenix/CHANGELOG.md`, `test/package.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: `packageVersion: string` exported from `src/version.ts`; version `0.1.0` in `package.json` and `mix.exs` that Task 4's `release-check.sh` compares against the tag; changelog headings `## [0.1.0] - 2026-09-25` that Task 4 extracts release notes from.

- [ ] **Step 1: Write the failing version test**

Create `test/version.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { packageVersion } from "../src/version.js";

test("the MCP server version is the package version", async () => {
  const pkg = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  assert.equal(packageVersion, pkg.version);
  assert.match(packageVersion, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
});
```

- [ ] **Step 2: Extend the package test**

In `test/package.test.ts`, widen the `pkg` type with `version: string;` and add to the first test:

```ts
const mixExs = await readFile(
  new URL("../../packages/phoenix/mix.exs", import.meta.url),
  "utf8",
);
const mixVersion = /@version "([^"]+)"/.exec(mixExs)?.[1];
assert.equal(
  mixVersion,
  pkg.version,
  "package.json and mix.exs must carry the same version",
);
```

(The first test becomes `async`.) In the second test add `"scripts/"` and `".github/"` to the `forbidden` list, and after the forbidden loop add:

```ts
assert.ok(
  files.every((f) => !f.endsWith(".map")),
  "source maps are not shipped; they would point at absent src/ files",
);
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run build 2>&1 | tail -3; node --test dist/test/version.test.js dist/test/package.test.js 2>&1 | grep -E "^(not ok|ok|ℹ (pass|fail))"`
Expected: the build fails on the missing `../src/version.js` import (TS2307). If tsc still emits, `version.test` fails with "Cannot find module"; `package.test` fails on the `.map` assertion (maps are in the tarball today) and on `mixVersion` vs `pkg.version` only if the two already differ (they do not; both are `0.1.0-alpha.1`).

- [ ] **Step 4: Create `src/version.ts` and use it**

```ts
import { createRequire } from "node:module";

// Compiled to dist/src/, so package.json is two levels up. Read at runtime so
// a version bump in package.json is the only edit a release needs.
const require = createRequire(import.meta.url);
export const packageVersion: string = (
  require("../../package.json") as { version: string }
).version;
```

In `src/mcp.ts` add `import { packageVersion } from "./version.js";` and change line 11 to:

```ts
const server = new McpServer({ name: "litewave", version: packageVersion });
```

Add to `src/index.ts`: `export { packageVersion } from "./version.js";`

In `src/profile.ts:25` change the message to:

```ts
      "The installed Playwright driver differs from Litewave's qualified pin. Reinstall litewave (contributors working from a checkout: run npm ci), then open the browser again.",
```

Grep `test/` for the old text ("Run npm ci before opening a browser") and update any assertion.

- [ ] **Step 5: Bump both versions**

Run: `npm version 0.1.0 --no-git-tag-version`
Expected: prints `v0.1.0`; `package.json` and `package-lock.json` (both top-level `version` and `packages[""].version`) now say `0.1.0`.

In `packages/phoenix/mix.exs:4`: `@version "0.1.0"`.

In `package.json` `files`, add the exclusion after `"dist/src"`:

```json
    "dist/src",
    "!dist/src/**/*.map",
```

- [ ] **Step 6: Date the changelogs**

Root `CHANGELOG.md`: replace

```markdown
## [Unreleased]

Initial public release candidate.
```

with

```markdown
## [Unreleased]

## [0.1.0] - 2026-09-25

Initial public release.
```

and append at the end of the file (blank line before):

```markdown
[Unreleased]: https://github.com/jtippett/litewave/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/jtippett/litewave/releases/tag/v0.1.0
```

`packages/phoenix/CHANGELOG.md`: the same replacement (its intro line is also "Initial public release candidate.") and the same two link lines. Every heading under the old Unreleased section (`### Added`, `### Security`, …) now sits under `## [0.1.0] - 2026-09-25`.

- [ ] **Step 7: Run the gates**

Run: `npm run format && npm run check 2>&1 | grep -E "^ℹ (tests|pass|fail)|error"`
Expected: `tests 21`, `pass 21`, `fail 0` (19 + version test + nothing else new; the package test grew but did not split). If prettier reformatted `package.json`, that is expected.

Run: `npm pack --dry-run 2>&1 | grep -c "\.map"`
Expected: `0`.

Run: `(cd packages/phoenix && mix precommit 2>&1 | grep -E "Result:|no issues|Total errors")`
Expected: `found no issues`, `Total errors: 0`, `48 passed, 3 excluded`.

Run: `(cd packages/phoenix && mix docs 2>&1 | grep -ci warning)`
Expected: `0`.

- [ ] **Step 8: Commit**

```bash
git add src/version.ts src/mcp.ts src/index.ts src/profile.ts package.json package-lock.json packages/phoenix/mix.exs CHANGELOG.md packages/phoenix/CHANGELOG.md test/version.test.ts test/package.test.ts
git -c commit.gpgsign=false commit -m "Release 0.1.0: versions in package.json and mix.exs only, MCP reports the package version, no source maps in the tarball"
```

---

### Task 2: Dependency hygiene: mint 1.10.1 and Dependabot

**Files:**

- Modify: `packages/phoenix/mix.lock`
- Create: `.github/dependabot.yml`

**Interfaces:**

- Consumes: nothing.
- Produces: a lockfile with no `mix hex.audit` advisories, which Task 3's CI step asserts.

- [ ] **Step 1: Confirm the advisory, then update mint**

Run: `(cd packages/phoenix && mix hex.audit 2>&1 | grep -E "mint|Found|No packages")`
Expected: `mint 1.10.0 - EEF-CVE-2026-82672 (MEDIUM)` and `Found packages with security advisories`.

Run: `(cd packages/phoenix && mix deps.update mint 2>&1 | grep -i mint && mix hex.audit 2>&1 | tail -1)`
Expected: `Upgraded: mint 1.10.0 => 1.10.1` (or the current patch), then `No packages with security advisories found`. If `mix deps.update mint` also moves `finch` or `req`, that is acceptable only for patch versions; otherwise run `mix deps.update mint --only mint` is not a real flag, so instead restore `mix.lock` and pin `{:mint, "~> 1.10.1", only: :test, override: false}`? No: do not add mint to `deps/0`. If the update drags a minor bump of `req` or `finch`, accept it, run the full `mix precommit`, and record the moved packages in the report.

- [ ] **Step 2: Write `.github/dependabot.yml`**

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
      day: monday
    versioning-strategy: increase
    open-pull-requests-limit: 5
    labels: [dependencies, npm]
  - package-ecosystem: mix
    directory: /packages/phoenix
    schedule:
      interval: weekly
      day: monday
    open-pull-requests-limit: 5
    labels: [dependencies, hex]
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
      day: monday
    open-pull-requests-limit: 5
    labels: [dependencies, actions]
```

- [ ] **Step 3: Validate**

Run: `ruby -ryaml -e 'y = YAML.load_file(".github/dependabot.yml"); puts y["updates"].map { |u| u["package-ecosystem"] }.inspect'`
Expected: `["npm", "mix", "github-actions"]`.

Run: `npx prettier --check .github/dependabot.yml && (cd packages/phoenix && mix precommit 2>&1 | grep -E "Result:|Total errors")`
Expected: prettier clean; `Total errors: 0`; `48 passed, 3 excluded`.

- [ ] **Step 4: Commit**

```bash
git add packages/phoenix/mix.lock .github/dependabot.yml
git -c commit.gpgsign=false commit -m "Update mint to 1.10.1 (EEF-CVE-2026-82672) and add weekly Dependabot for npm, Hex and Actions"
```

---

### Task 3: CI pins Hex packaging, docs, and the audit

**Files:**

- Modify: `.github/workflows/ci.yml` (phoenix job)

**Interfaces:**

- Consumes: Task 2's clean lockfile; Task 1's `mix.exs`.
- Produces: the `phoenix` job Task 4's release workflow mirrors.

- [ ] **Step 1: Edit the phoenix job**

Change `timeout-minutes: 20` to `timeout-minutes: 30`.

After the final `- run: mix precommit` step, append:

```yaml
- run: mix hex.audit
  working-directory: packages/phoenix
- run: mix docs --warnings-as-errors
  working-directory: packages/phoenix
  env:
    MIX_ENV: dev
- run: mix hex.build
  working-directory: packages/phoenix
  env:
    MIX_ENV: dev
- name: Hex tarball ships the notices and changelog
  working-directory: packages/phoenix
  env:
    MIX_ENV: dev
  run: |
    mix hex.build --unpack -o hex-build
    for f in CHANGELOG.md LICENSE LICENSE-APACHE NOTICE README.md mix.exs .formatter.exs; do
      [ -e "hex-build/$f" ] || { echo "missing $f in Hex tarball"; exit 1; }
    done
    rm -rf hex-build
```

Also add `/packages/phoenix/hex-build/` and `/packages/phoenix/*.tar` to the root `.gitignore` under the Phoenix block (local runs of the same commands).

- [ ] **Step 2: Validate the YAML and run the new steps locally**

Run: `ruby -ryaml -e 'y = YAML.load_file(".github/workflows/ci.yml"); j = y["jobs"]["phoenix"]; puts j["timeout-minutes"]; puts j["steps"].map { |s| s["run"].to_s.lines.first.to_s.strip }.last(5).inspect'`
Expected: `30` and the five new run lines (`mix hex.audit`, `mix docs --warnings-as-errors`, `mix hex.build`, `mix hex.build --unpack -o hex-build`, preceded by `mix precommit`).

Run: `(cd packages/phoenix && mix hex.audit | tail -1 && MIX_ENV=dev mix docs --warnings-as-errors 2>&1 | tail -1 && MIX_ENV=dev mix hex.build --unpack -o hex-build && ls hex-build && rm -rf hex-build *.tar)`
Expected: `No packages with security advisories found`; docs build without warnings (last line names the generated docs); the listing shows `CHANGELOG.md LICENSE LICENSE-APACHE NOTICE README.md hex_metadata.config lib mix.exs` and `.formatter.exs` (hidden; check with `ls -a` if absent).

Run: `npx prettier --check .github/workflows/ci.yml .gitignore 2>&1 | tail -1`
Expected: clean (`.gitignore` is not a prettier target; the command still exits 0 for the workflow).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml .gitignore
git -c commit.gpgsign=false commit -m "CI: audit Hex deps, build docs with warnings as errors, and check the Hex tarball contents"
```

---

### Task 4: Tag-driven release workflow with an approval gate

**Files:**

- Create: `scripts/release-check.sh`, `test/release-check.test.ts`, `.github/workflows/release.yml`

**Interfaces:**

- Consumes: Task 1's versions and changelog headings; Task 3's phoenix job shape.
- Produces: `scripts/release-check.sh TAG` (exit 0 when `TAG` = `v<version>` in `package.json`, `mix.exs`, and both changelogs; prints the mismatch and exits 1 otherwise; with `--notes FILE` writes the root changelog section for the tag to `FILE`). The `release` workflow Task 5's CONTRIBUTING describes.

- [ ] **Step 1: Write the failing test**

Create `test/release-check.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));
const script = path.join(root, "scripts", "release-check.sh");
const pkg = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
) as { version: string };

async function check(tag: string, extra: string[] = []) {
  try {
    const { stdout } = await run("bash", [script, tag, ...extra], {
      cwd: root,
    });
    return { code: 0, out: stdout };
  } catch (error) {
    const e = error as { code: number; stdout: string; stderr: string };
    return { code: e.code, out: e.stdout + e.stderr };
  }
}

test("release-check accepts the tag that matches both versions and both changelogs", async () => {
  const result = await check(`v${pkg.version}`);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, new RegExp(`v${pkg.version.replace(/\./g, "\\.")}`));
});

test("release-check refuses a tag that matches nothing", async () => {
  const result = await check("v9.9.9");
  assert.equal(result.code, 1);
  assert.match(result.out, /package\.json/);
  assert.match(result.out, /9\.9\.9/);
});

test("release-check refuses a tag without the v prefix", async () => {
  const result = await check(pkg.version);
  assert.equal(result.code, 1);
  assert.match(result.out, /must look like v1\.2\.3/);
});

test("release-check writes the changelog section as release notes", async () => {
  const dir = await mkdtemp("/tmp/lw-notes-");
  try {
    const notes = path.join(dir, "notes.md");
    const result = await check(`v${pkg.version}`, ["--notes", notes]);
    assert.equal(result.code, 0, result.out);
    const text = await readFile(notes, "utf8");
    assert.match(text, /^## \[/m);
    assert.match(text, /### Added/);
    assert.doesNotMatch(text, /## \[Unreleased\]/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build 2>&1 | tail -1; node --test dist/test/release-check.test.js 2>&1 | grep -E "^(not ok|ok|ℹ (pass|fail))"`
Expected: four `not ok` (bash reports the script does not exist, exit code 127, so even the "refuses" tests fail on their exact-code and message assertions).

- [ ] **Step 3: Write `scripts/release-check.sh`**

```bash
#!/usr/bin/env bash
# Usage: scripts/release-check.sh vX.Y.Z [--notes FILE]
# Exits 0 when the tag matches package.json, packages/phoenix/mix.exs and a
# dated section in both changelogs. With --notes, writes the root changelog
# section for the tag to FILE (GitHub release notes).
set -euo pipefail

tag="${1:-}"
notes=""
if [ "${2:-}" = "--notes" ]; then notes="${3:-}"; fi

if [[ ! "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]]; then
  echo "release-check: tag '$tag' must look like v1.2.3" >&2
  exit 1
fi
version="${tag#v}"

pkg=$(node -p "require('./package.json').version")
mix=$(sed -n 's/^  @version "\(.*\)"$/\1/p' packages/phoenix/mix.exs)

fail=0
[ "$pkg" = "$version" ] || { echo "release-check: package.json is $pkg, tag is $version" >&2; fail=1; }
[ "$mix" = "$version" ] || { echo "release-check: packages/phoenix/mix.exs is $mix, tag is $version" >&2; fail=1; }
for changelog in CHANGELOG.md packages/phoenix/CHANGELOG.md; do
  grep -q "^## \[$version\] - [0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}$" "$changelog" ||
    { echo "release-check: $changelog has no dated '## [$version] - YYYY-MM-DD' section" >&2; fail=1; }
done
[ "$fail" -eq 0 ] || exit 1

if [ -n "$notes" ]; then
  awk -v v="$version" '
    /^## \[/ { printing = index($0, "[" v "]") > 0 }
    /^\[.*\]: http/ { printing = 0 }
    printing
  ' CHANGELOG.md > "$notes"
  [ -s "$notes" ] || { echo "release-check: no notes extracted for $version" >&2; exit 1; }
fi

echo "release-check: $tag matches package.json, mix.exs and both changelogs"
```

Run: `chmod +x scripts/release-check.sh`

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build 2>&1 | tail -1; node --test dist/test/release-check.test.js 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `pass 4`, `fail 0`.

Run: `bash scripts/release-check.sh v0.1.0 --notes /tmp/lw-notes.md && head -3 /tmp/lw-notes.md && rm /tmp/lw-notes.md`
Expected: the "matches" line, then `## [0.1.0] - 2026-09-25`, a blank line, `Initial public release.`

- [ ] **Step 5: Write `.github/workflows/release.yml`**

```yaml
name: Release
on:
  push:
    tags: ["v*"]
permissions:
  contents: read
concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false
jobs:
  check:
    name: Tag matches versions and changelogs
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .node-version
      - run: bash scripts/release-check.sh "$GITHUB_REF_NAME"

  node:
    name: Node ${{ matrix.node }} on ${{ matrix.os }}
    needs: check
    strategy:
      fail-fast: true
      matrix:
        os: [macos-latest, ubuntu-latest]
        node: ["24.21.0", "26"]
    runs-on: ${{ matrix.os }}
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: npm
      - run: npm ci
      - run: npm run check
      - run: npx --no-install playwright install --with-deps chromium
      - run: npm run test:browser

  phoenix:
    name: Elixir ${{ matrix.elixir }} / OTP ${{ matrix.otp }}
    needs: check
    strategy:
      fail-fast: true
      matrix:
        include:
          - elixir: "1.17.3"
            otp: "27"
          - elixir: "1.20.4"
            otp: "29"
    runs-on: ubuntu-latest
    timeout-minutes: 30
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: litewave_phoenix_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    env:
      MIX_ENV: test
      LITEWAVE_TEST_DATABASE_URL: postgresql://postgres:postgres@localhost:5432/litewave_phoenix_test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .node-version
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: erlef/setup-beam@v1
        with:
          otp-version: ${{ matrix.otp }}
          elixir-version: ${{ matrix.elixir }}
      - run: mix deps.get
        working-directory: packages/phoenix
      - run: mix precommit
        working-directory: packages/phoenix
      - run: mix hex.audit
        working-directory: packages/phoenix
      - run: mix docs --warnings-as-errors
        working-directory: packages/phoenix
        env:
          MIX_ENV: dev
      - run: mix hex.build
        working-directory: packages/phoenix
        env:
          MIX_ENV: dev

  publish:
    name: Publish to npm and Hex
    needs: [check, node, phoenix]
    runs-on: ubuntu-latest
    timeout-minutes: 20
    environment:
      name: release
      url: https://www.npmjs.com/package/litewave
    permissions:
      contents: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .node-version
          cache: npm
          registry-url: https://registry.npmjs.org
      - uses: erlef/setup-beam@v1
        with:
          otp-version: "29"
          elixir-version: "1.20.4"
      - run: npm ci
      - run: npm run build
      - name: Publish npm package with provenance
        run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
      - run: mix deps.get
        working-directory: packages/phoenix
      - name: Publish Hex package and docs
        run: mix hex.publish --yes
        working-directory: packages/phoenix
        env:
          HEX_API_KEY: ${{ secrets.HEX_API_KEY }}
      - name: Create the GitHub release from the changelog
        run: |
          bash scripts/release-check.sh "$GITHUB_REF_NAME" --notes release-notes.md
          gh release create "$GITHUB_REF_NAME" --verify-tag --title "Litewave $GITHUB_REF_NAME" --notes-file release-notes.md
        env:
          GH_TOKEN: ${{ github.token }}
```

Notes for the implementer, not to be copied into the file: `npm publish` runs `prepublishOnly` (`npm run check`) again on the publish runner, which is intended. `mix hex.publish` in the default `:dev` env compiles ex_doc and publishes package and docs together. The `release` environment's required reviewer is configured on GitHub, not in this file.

- [ ] **Step 6: Validate the workflow**

Run: `ruby -ryaml -e 'y = YAML.load_file(".github/workflows/release.yml"); puts y["on"]["push"]["tags"].inspect; puts y["jobs"].keys.inspect; p = y["jobs"]["publish"]; puts p["needs"].inspect, p["environment"]["name"], p["permissions"].inspect'`
Expected: `["v*"]`; `["check", "node", "phoenix", "publish"]`; `["check", "node", "phoenix"]`; `release`; `{"contents"=>"write", "id-token"=>"write"}`.

Run: `npm run format:check 2>&1 | tail -1 && npm run check 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: prettier clean (run `npm run format` first if the new YAML or test needs it); `tests 25`, `pass 25`, `fail 0` (21 + 4 release-check tests).

Run: `npm pack --dry-run 2>&1 | grep -c "scripts/"`
Expected: `0` (the pack test also asserts it).

- [ ] **Step 7: Commit**

```bash
git add scripts/release-check.sh test/release-check.test.ts .github/workflows/release.yml
git -c commit.gpgsign=false commit -m "Release workflow: verify the tag against versions and changelogs, run both suites, publish npm and Hex after approval, create the GitHub release"
```

---

### Task 5: Repository hygiene and the release runbook

**Files:**

- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`, `.github/ISSUE_TEMPLATE/feature_request.yml`, `.github/ISSUE_TEMPLATE/config.yml`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/CODEOWNERS`
- Modify: `CONTRIBUTING.md` (new "Releasing" section before "Changes and reviews" closing line), `docs/status.md` ("How it is verified")

**Interfaces:**

- Consumes: Task 4's workflow and script names.
- Produces: the contributor-facing description of the release process.

- [ ] **Step 1: Issue forms**

`.github/ISSUE_TEMPLATE/config.yml`:

```yaml
blank_issues_enabled: false
contact_links:
  - name: Security vulnerability
    url: https://github.com/jtippett/litewave/security/advisories/new
    about: Report privately. Please do not open a public issue for security problems.
```

`.github/ISSUE_TEMPLATE/bug_report.yml`:

```yaml
name: Bug report
description: Something Litewave does wrong, or an outcome it reports incorrectly
labels: [bug]
body:
  - type: markdown
    attributes:
      value: Keep tokens, cookies, customer data and private URLs out of this report.
  - type: textarea
    id: what
    attributes:
      label: What happened
      description: The command or MCP tool call, the JSON result, and what you expected instead.
    validations:
      required: true
  - type: textarea
    id: doctor
    attributes:
      label: litewave doctor output
      description: Run `litewave doctor --project PATH` and paste the JSON. Redact anything private.
      render: json
  - type: input
    id: version
    attributes:
      label: Litewave version
      description: "`litewave --version` is not implemented yet: use `npm ls -g litewave` or the version in your lockfile, and the `litewave_phoenix` version from `mix.lock` if the Phoenix tools are involved."
    validations:
      required: true
  - type: input
    id: platform
    attributes:
      label: Platform
      description: OS and version, Node version, and (for Phoenix issues) Elixir and OTP versions.
    validations:
      required: true
  - type: dropdown
    id: area
    attributes:
      label: Area
      options:
        - Browser (CLI or MCP)
        - Phoenix runtime tools
        - Installation or packaging
        - Documentation
    validations:
      required: true
```

`.github/ISSUE_TEMPLATE/feature_request.yml`:

```yaml
name: Feature request
description: A capability Litewave should have
labels: [enhancement]
body:
  - type: textarea
    id: problem
    attributes:
      label: What you are trying to do
      description: The task, the agent or tool you use, and where Litewave stops you today.
    validations:
      required: true
  - type: textarea
    id: proposal
    attributes:
      label: Proposed behaviour
      description: What the command, tool, or option would do, and how its outcome would be reported.
    validations:
      required: true
  - type: checkboxes
    id: scope
    attributes:
      label: Scope check
      options:
        - label: This is generic (works for ordinary web pages or any Phoenix app), not specific to one application.
          required: true
```

- [ ] **Step 2: PR template and CODEOWNERS**

`.github/PULL_REQUEST_TEMPLATE.md`:

```markdown
## What changes for a user

<!-- Behaviour, its boundaries, and how outcomes are reported. -->

## How it was validated

<!-- Commands run and what they showed: npm run check, npm run test:browser, mix precommit. -->

## Checklist

- [ ] `npm run check` passes; `npm run test:browser` was run for browser, storage, transport or ownership changes
- [ ] `mix precommit` passes in `packages/phoenix` if it changed
- [ ] `docs/status.md` and the relevant `CHANGELOG.md` `[Unreleased]` section are updated
- [ ] No tokens, customer artifacts or private URLs in the diff or this description
- [ ] Uncertain mutations are still never replayed automatically
```

`.github/CODEOWNERS`:

```
# Reviews requested automatically for every change.
* @jtippett
```

- [ ] **Step 3: CONTRIBUTING "Releasing" section**

Insert before the final line of `CONTRIBUTING.md` ("Security reports go through…"):

```markdown
## Releasing

Both packages share one version and one tag. To release `X.Y.Z`:

1. Move the `[Unreleased]` entries in `CHANGELOG.md` and `packages/phoenix/CHANGELOG.md` under a new `## [X.Y.Z] - YYYY-MM-DD` heading and add the compare links at the bottom of each file.
2. Bump the version: `npm version X.Y.Z --no-git-tag-version` and `@version "X.Y.Z"` in `packages/phoenix/mix.exs`. `scripts/release-check.sh vX.Y.Z` must pass; it is also what the release workflow runs.
3. Commit as `Release X.Y.Z`, then tag and push: `git tag -a vX.Y.Z -m "Litewave X.Y.Z" && git push origin main vX.Y.Z`.
4. The `Release` workflow re-runs both suites, then waits in the `release` environment for the maintainer's approval. Approval publishes `litewave` to npm with provenance and `litewave_phoenix` (with docs) to Hex, and creates the GitHub release from the changelog section.

Secrets the `release` environment needs: `NPM_TOKEN` (an npm granular access token with publish rights and 2FA bypass for automation) and `HEX_API_KEY` (`mix hex.user key generate --permission api:write`). Dependabot opens weekly update pull requests for npm, Hex and GitHub Actions; lockfile changes are reviewed like any other change.
```

- [ ] **Step 4: docs/status.md**

Under "## How it is verified", after the `mix precommit` bullet, add:

```markdown
- The `Release` workflow, on a `v*` tag: `scripts/release-check.sh` confirms
  the tag matches `package.json`, `mix.exs` and a dated section in both
  changelogs; both suites run again; publishing to npm (with provenance) and
  Hex happens only after approval in the `release` environment.
- CI also runs `mix hex.audit`, `mix docs --warnings-as-errors`, and checks
  that the Hex tarball ships the changelog, both licences and `NOTICE`.
```

- [ ] **Step 5: Validate**

Run: `for f in .github/ISSUE_TEMPLATE/*.yml; do ruby -ryaml -e 'y = YAML.load_file(ARGV[0]); puts "#{ARGV[0]}: #{(y["body"] || y["contact_links"]).length} entries"' "$f"; done`
Expected: `config.yml: 1 entries`, `bug_report.yml: 6 entries`, `feature_request.yml: 3 entries`.

Run: `npm run format && npm run check 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: `tests 25`, `pass 25`, `fail 0`; prettier may reflow the new Markdown and YAML, which is fine.

Run: `grep -c "Releasing" CONTRIBUTING.md; grep -c "release-check" docs/status.md`
Expected: `1` and `1`.

- [ ] **Step 6: Commit**

```bash
git add .github/ISSUE_TEMPLATE .github/PULL_REQUEST_TEMPLATE.md .github/CODEOWNERS CONTRIBUTING.md docs/status.md
git -c commit.gpgsign=false commit -m "Issue forms, PR template, CODEOWNERS, and the release runbook"
```

---

## Hand-off checklist for James (not automated by this plan)

1. Create `github.com/jtippett/litewave`, add it as `origin`, push `main` (re-sign commits first with `git rebase --gpg-sign` if wanted).
2. Settings → Environments → `release`: add James as a required reviewer; add secrets `NPM_TOKEN` and `HEX_API_KEY`.
3. Settings → Code security: enable private vulnerability reporting (or `gh api -X PUT repos/jtippett/litewave/private-vulnerability-reporting`) and Dependabot alerts.
4. Confirm the names are still free: `npm view litewave` (404) and `mix hex.info litewave_phoenix` ("No package").
5. If publishing on a day other than 2026-09-25, edit the date in both `## [0.1.0]` headings in the release commit.
6. `git tag -a v0.1.0 -m "Litewave 0.1.0" && git push origin v0.1.0`, then approve the `publish` job when it pauses.
7. After publishing, check `npm view litewave dist-tags` shows `latest: 0.1.0` and open <https://hexdocs.pm/litewave_phoenix>.

## Self-review

- **Spec coverage (section 7):** release workflow on `v*` with both suites and an approval-gated publish job (Task 4); npm provenance and `HEX_API_KEY` (Task 4); Dependabot for npm, Hex, Actions weekly (Task 2); issue templates, PR template, CODEOWNERS (Task 5); private vulnerability reporting is a GitHub setting (checklist) and SECURITY.md already links it. Carry-overs: version alignment (Task 1), Hex packaging in CI (Task 3), source maps (Task 1), phoenix timeout (Task 3), mint advisory (Task 2), `latest` dist-tag (checklist), `profile.ts` message (Task 1).
- **Placeholder scan:** none; every file's content is given. Task 2 Step 1 contains a deliberately rejected alternative ("is not a real flag") to stop the implementer from pinning mint; the instruction that stands is "accept patch bumps, report minor bumps".
- **Type consistency:** `packageVersion` is the only new export and is used identically in `src/mcp.ts`, `src/index.ts`, and `test/version.test.ts`. `scripts/release-check.sh TAG [--notes FILE]` is invoked the same way in the test, the workflow, and CONTRIBUTING. Test counts: 19 today → 21 after Task 1 (one new file with one test; `package.test.ts` keeps two tests) → 25 after Task 4.
- **Review Focus:** all five lines have a task; #5 is pinned by CI rather than a unit test, and says so.
