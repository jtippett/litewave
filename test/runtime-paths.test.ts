import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
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

test("LITEWAVE_HOME expands a leading ~ and resolves relative paths like Elixir's Path.expand", () => {
  const previous = process.env.LITEWAVE_HOME;
  try {
    process.env.LITEWAVE_HOME = "~/lw-home-test";
    assert.equal(home(), path.join(homedir(), "lw-home-test"));
    process.env.LITEWAVE_HOME = "relative-home";
    assert.equal(home(), path.resolve("relative-home"));
    process.env.LITEWAVE_HOME = "~";
    assert.equal(home(), homedir());
    process.env.LITEWAVE_HOME = "";
    assert.equal(home(), path.resolve(""));
  } finally {
    if (previous === undefined) delete process.env.LITEWAVE_HOME;
    else process.env.LITEWAVE_HOME = previous;
  }
});
