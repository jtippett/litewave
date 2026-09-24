import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  home,
  projectDirectory,
  projectKey,
  runtimeSocketPath,
} from "../src/storage.js";

test("runtime paths derive from LITEWAVE_HOME and the canonical project only", () => {
  const previous = process.env.LITEWAVE_HOME;
  process.env.LITEWAVE_HOME = "/tmp/lw-home";
  try {
    const canonical = "/tmp/project";
    const key = createHash("sha256")
      .update(canonical)
      .digest("hex")
      .slice(0, 24);
    assert.equal(projectKey(canonical), key);
    assert.equal(home(), "/tmp/lw-home");
    assert.equal(
      projectDirectory(canonical),
      path.join("/tmp/lw-home", "projects", key),
    );
    assert.equal(
      runtimeSocketPath(canonical),
      path.join("/tmp/lw-home", "run", `p${key.slice(0, 16)}.sock`),
    );
  } finally {
    if (previous === undefined) delete process.env.LITEWAVE_HOME;
    else process.env.LITEWAVE_HOME = previous;
  }
});
