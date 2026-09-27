import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

// The release workflow cannot run locally; these pins read it as text so the
// publish order and its guards cannot regress silently.
const workflow = await readFile(
  new URL("../../.github/workflows/release.yml", import.meta.url),
  "utf8",
);

test("publish waits for the tag check and both suites", () => {
  assert.match(workflow, /needs: \[check, node, phoenix\]/);
  assert.doesNotMatch(workflow, /if: always\(\)/);
});

test("Hex is published before npm because only Hex can be reverted", () => {
  const hex = workflow.indexOf("mix hex.publish --yes");
  const npm = workflow.indexOf("npm publish --provenance");
  assert.ok(hex > 0 && npm > 0, "both publish steps exist");
  assert.ok(hex < npm, "mix hex.publish must run before npm publish");
});

test("both registries are dry-run first and skipped when the version already exists", () => {
  assert.match(workflow, /mix hex\.publish --dry-run --yes/);
  assert.match(workflow, /npm publish --dry-run/);
  assert.match(workflow, /mix hex\.info litewave_phoenix "\$version"/);
  assert.match(workflow, /npm view "litewave@\$version" version/);
});

test("npm authenticates with trusted publishing (OIDC), never a stored token", () => {
  assert.match(workflow, /id-token: write/);
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|NPM_TOKEN/);
  // setup-node's registry-url writes an .npmrc that reads NODE_AUTH_TOKEN, and
  // npm refuses to start when a referenced env var is unset.
  assert.doesNotMatch(workflow, /registry-url:/);
});

test("a re-run after a partial publish skips the dry-runs as well as the publishes", () => {
  // One step records what each registry already has; every publish-shaped
  // step, dry-run included, is conditioned on it. npm's dry-run fails on an
  // existing version, which is how the first 0.1.0 re-run died.
  assert.match(workflow, /id: published/);
  const npmGuard =
    workflow.match(/if: steps\.published\.outputs\.npm != 'true'/g) ?? [];
  const hexGuard =
    workflow.match(/if: steps\.published\.outputs\.hex != 'true'/g) ?? [];
  assert.equal(npmGuard.length, 2, "npm dry-run and publish are both guarded");
  assert.equal(hexGuard.length, 2, "Hex dry-run and publish are both guarded");
  assert.match(
    workflow,
    /if: steps\.published\.outputs\.npm != 'true'\n(?:\s+\S.*\n)*?\s+run: npm publish --dry-run/,
  );
  assert.match(
    workflow,
    /if: steps\.published\.outputs\.hex != 'true'\n(?:\s+\S.*\n)*?\s+run: mix hex\.publish --dry-run --yes/,
  );
  assert.match(
    workflow,
    /gh release view "\$GITHUB_REF_NAME"/,
    "GitHub release step skips an existing release",
  );
});
