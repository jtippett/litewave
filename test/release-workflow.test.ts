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
