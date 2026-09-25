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
