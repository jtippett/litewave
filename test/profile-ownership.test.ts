import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, symlink, readlink, rm } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { assertProfileAvailable } from "../src/profile-ownership.js";
import { register, atomicJson } from "../src/storage.js";

test("only a matching closed session with an absent owner may ask Chromium to reacquire its own lock", async () => {
  const root = await mkdtemp("/tmp/lw-owner-");
  const previous = process.env.LITEWAVE_HOME;
  process.env.LITEWAVE_HOME = path.join(root, "state");
  try {
    const project = path.join(root, "project");
    await mkdir(project);
    const r = await register(project, "http://localhost:4000");
    const profile = path.join(r.directory, "profile");
    await mkdir(profile);
    const child = spawn(process.execPath, ["-e", ""]);
    await new Promise<void>((resolve, reject) => {
      child.once("exit", () => resolve());
      child.once("error", reject);
    });
    const owner = `${hostname()}-${child.pid!}`;
    const lock = path.join(profile, "SingletonLock");
    await symlink(owner, lock);
    await assert.rejects(assertProfileAvailable(r, profile), {
      code: "profile_in_use",
    });
    const record = {
      projectId: r.id,
      profile,
      lockOwner: owner,
      state: "closed",
    };
    const file = path.join(r.directory, "session.json");
    for (const change of [
      { state: "ready" },
      { projectId: "another-registration" },
      { profile: root },
      { lockOwner: "unrelated" },
    ]) {
      await atomicJson(file, { ...record, ...change });
      await assert.rejects(assertProfileAvailable(r, profile), {
        code: "profile_in_use",
      });
    }
    await atomicJson(file, record);
    await assertProfileAvailable(r, profile);
    assert.equal(
      await readlink(lock),
      owner,
      "Litewave must not delete the lock",
    );
    await rm(lock);
    const liveOwner = `${hostname()}-${process.pid}`;
    await symlink(liveOwner, lock);
    await atomicJson(file, { ...record, lockOwner: liveOwner });
    await assert.rejects(assertProfileAvailable(r, profile), {
      code: "profile_in_use",
    });
    assert.equal(await readlink(lock), liveOwner);
  } finally {
    if (previous === undefined) delete process.env.LITEWAVE_HOME;
    else process.env.LITEWAVE_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
});
