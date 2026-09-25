import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
// Compiled to dist/test/, so the repository root is two levels up.
const root = fileURLToPath(new URL("../../", import.meta.url));
const pkg = JSON.parse(
  await readFile(new URL("../../package.json", import.meta.url), "utf8"),
) as {
  name: string;
  version: string;
  private?: boolean;
  repository: { url: string };
  homepage: string;
  bugs: { url: string };
  keywords: string[];
  engines: { node: string };
  scripts: Record<string, string>;
  files: string[];
};

test("package metadata is publishable", async () => {
  assert.equal(pkg.name, "litewave");
  assert.equal(pkg.private, undefined);
  assert.equal(
    pkg.repository.url,
    "git+https://github.com/jtippett/litewave.git",
  );
  assert.equal(pkg.bugs.url, "https://github.com/jtippett/litewave/issues");
  assert.match(pkg.homepage, /github\.com\/jtippett\/litewave/);
  assert.ok(pkg.keywords.includes("mcp") && pkg.keywords.includes("phoenix"));
  assert.equal(pkg.engines.node, ">=24.21.0");
  assert.equal(pkg.scripts.prepublishOnly, "npm run check");
  assert.equal(
    pkg.scripts.postinstall,
    undefined,
    "Chromium is installed only explicitly",
  );
  assert.equal(pkg.scripts.lint, "oxlint src test");
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
});

test("npm pack ships the CLI, notices, and architecture doc and nothing private", async () => {
  const { stdout } = await run("npm", ["pack", "--dry-run", "--json"], {
    cwd: root,
  });
  const files = (
    JSON.parse(stdout) as [{ files: { path: string }[] }]
  )[0].files.map((f) => f.path);
  for (const required of [
    "package.json",
    "dist/src/cli.js",
    "dist/src/index.js",
    "dist/src/index.d.ts",
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
    "NOTICE",
    "docs/architecture.md",
  ])
    assert.ok(files.includes(required), `${required} must be in the tarball`);
  for (const forbidden of [
    "dist/test/",
    "test/",
    "src/",
    "packages/",
    "local-feedback/",
    "docs/status.md",
    ".oxlintrc.json",
    "scripts/",
    ".github/",
  ])
    assert.ok(
      files.every((f) => !f.startsWith(forbidden)),
      `${forbidden} must not be in the tarball`,
    );
  assert.ok(
    files.every((f) => !f.endsWith(".map")),
    "source maps are not shipped; they would point at absent src/ files",
  );
});
