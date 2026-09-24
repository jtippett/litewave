import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { selectProfile } from "../src/profile.js";
import { register, atomicJson } from "../src/storage.js";

test("a browser downgrade never opens a newer profile; explicit replacement leaves it intact", async () => {
  const root = await mkdtemp("/tmp/lw-profile-");
  const previous = process.env.LITEWAVE_HOME;
  process.env.LITEWAVE_HOME = path.join(root, "state");
  try {
    const project = path.join(root, "project");
    await mkdir(project);
    const r = await register(project, "http://localhost:4000");
    const old = path.join(r.directory, "profile");
    await mkdir(old);
    await writeFile(path.join(old, "Last Version"), "153.0.8010.12");
    await writeFile(path.join(old, "retained"), "original profile");
    await assert.rejects(selectProfile(r, {}), {
      code: "profile_version_incompatible",
    });
    const fresh = await selectProfile(r, { freshProfile: true });
    assert.notEqual(fresh.directory, old);
    assert.equal(
      await readFile(path.join(old, "retained"), "utf8"),
      "original profile",
    );
    await atomicJson(path.join(r.directory, "browser-profile.json"), {
      name: fresh.name,
    });
    assert.equal((await selectProfile(r, {})).directory, fresh.directory);
    await assert.rejects(selectProfile(r, { storageState: "anything.json" }), {
      code: "invalid_request",
    });
    await atomicJson(path.join(r.directory, "browser-profile.json"), {
      name: "../outside",
    });
    await assert.rejects(selectProfile(r, {}), { code: "storage_failure" });
  } finally {
    if (previous === undefined) delete process.env.LITEWAVE_HOME;
    else process.env.LITEWAVE_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
});
