import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
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
  const dir = await mkdtemp(path.join(os.tmpdir(), "lw-notes-"));
  try {
    const notes = path.join(dir, "notes.md");
    const result = await check(`v${pkg.version}`, ["--notes", notes]);
    assert.equal(result.code, 0, result.out);
    const text = await readFile(notes, "utf8");
    assert.match(
      text,
      new RegExp(
        `^## \\[${pkg.version.replace(/\./g, "\\.")}\\] - \\d{4}-\\d{2}-\\d{2}\\n`,
      ),
    );
    assert.match(text, /### Added/);
    assert.doesNotMatch(text, /## \[Unreleased\]/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("release-check refuses prerelease tags until the workflow can publish them as such", async () => {
  const result = await check("v0.2.0-rc.1");
  assert.equal(result.code, 1);
  assert.match(result.out, /prerelease/);
});

// Each check must fail on its own. A fixture copy of the four version files
// lets one be broken at a time.
async function fixture(mutate: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lw-release-check-"));
  for (const f of [
    "package.json",
    "CHANGELOG.md",
    "packages/phoenix/mix.exs",
    "packages/phoenix/CHANGELOG.md",
  ])
    await cp(path.join(root, f), path.join(dir, f));
  await mutate(dir);
  try {
    const { stdout } = await run("bash", [script, `v${pkg.version}`], {
      cwd: dir,
    });
    return { code: 0, out: stdout };
  } catch (error) {
    const e = error as { code: number; stdout: string; stderr: string };
    return { code: e.code, out: e.stdout + e.stderr };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function rewrite(file: string, edit: (s: string) => string) {
  await writeFile(file, edit(await readFile(file, "utf8")));
}

test("release-check names package.json alone when only its version differs", async () => {
  const result = await fixture((dir) =>
    rewrite(path.join(dir, "package.json"), (s) =>
      s.replace(`"version": "${pkg.version}"`, '"version": "9.9.9"'),
    ),
  );
  assert.equal(result.code, 1);
  assert.match(result.out, /package\.json is 9\.9\.9/);
  assert.doesNotMatch(result.out, /mix\.exs is/);
});

test("release-check names mix.exs alone when only @version differs", async () => {
  const result = await fixture((dir) =>
    rewrite(path.join(dir, "packages/phoenix/mix.exs"), (s) =>
      s.replace(`@version "${pkg.version}"`, '@version "9.9.9"'),
    ),
  );
  assert.equal(result.code, 1);
  assert.match(result.out, /mix\.exs is 9\.9\.9/);
  assert.doesNotMatch(result.out, /package\.json is/);
});

test("release-check refuses when the root changelog has no dated section", async () => {
  const result = await fixture((dir) =>
    rewrite(path.join(dir, "CHANGELOG.md"), (s) =>
      s.replace(`## [${pkg.version}] - `, `## [${pkg.version}] `),
    ),
  );
  assert.equal(result.code, 1);
  assert.match(result.out, /^release-check: CHANGELOG\.md has no dated/m);
  assert.doesNotMatch(result.out, /packages\/phoenix\/CHANGELOG\.md/);
});

test("release-check refuses when the Phoenix changelog lacks the section", async () => {
  const result = await fixture((dir) =>
    rewrite(path.join(dir, "packages/phoenix/CHANGELOG.md"), (s) =>
      s.replace(`## [${pkg.version}]`, "## [0.0.0]"),
    ),
  );
  assert.equal(result.code, 1);
  assert.match(result.out, /packages\/phoenix\/CHANGELOG\.md has no dated/);
  assert.doesNotMatch(result.out, /^release-check: CHANGELOG\.md/m);
});
