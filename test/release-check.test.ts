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
