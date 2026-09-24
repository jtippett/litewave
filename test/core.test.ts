import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  rm,
  stat,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Journal } from "../src/journal.js";
import { allowedUpload, register, publicRegistration } from "../src/storage.js";
import { operationSchema, type Operation } from "../src/protocol.js";

test("journal persists intent, deduplicates reordered arguments, and never replays an interrupted dispatch", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lw-journal-"));
  try {
    const journal = new Journal(dir);
    await journal.load();
    const op: Operation = {
      method: "click",
      requestId: "submit-1",
      tabId: "t1",
      target: { kind: "role", role: "button", name: "Submit" },
    };
    const { action, duplicate } = await journal.accept(op);
    assert.equal(duplicate, false);
    await journal.transition(action, "dispatching");
    const restored = new Journal(dir);
    await restored.load();
    assert.equal(restored.actions.get(op.requestId)?.state, "outcome_unknown");
    assert.equal(
      (
        await restored.accept({
          ...op,
          target: { name: "Submit", role: "button", kind: "role" },
        })
      ).duplicate,
      true,
    );
    await assert.rejects(restored.accept({ ...op, value: "changed" }), {
      code: "request_id_conflict",
    });
    const second = await restored.accept({
      ...op,
      requestId: "before-dispatch",
    });
    assert.equal(second.action.state, "accepted");
    const afterCrash = new Journal(dir);
    await afterCrash.load();
    assert.equal(
      afterCrash.actions.get("before-dispatch")?.state,
      "rejected_before_dispatch",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("upload boundaries resolve symlinks and reject sibling-prefix escapes", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lw-files-"));
  const allowed = path.join(dir, "allowed");
  const sibling = path.join(dir, "allowed-other");
  try {
    await mkdir(allowed);
    await mkdir(sibling);
    await writeFile(path.join(allowed, "ok.pdf"), "fixture");
    await writeFile(path.join(sibling, "secret.pdf"), "secret");
    await symlink(
      path.join(sibling, "secret.pdf"),
      path.join(allowed, "escape.pdf"),
    );
    assert.equal(
      (await allowedUpload(path.join(allowed, "ok.pdf"), [allowed])).size,
      7,
    );
    await assert.rejects(allowedUpload(path.join(allowed, "ok.pdf"), []), {
      code: "path_not_allowed",
      message:
        /No upload folders are configured.*dedicated uploads folder is optional/,
      nextOperation: "doctor",
    });
    await assert.rejects(
      allowedUpload(path.join(allowed, "escape.pdf"), [allowed]),
      { code: "path_not_allowed" },
    );
    await assert.rejects(
      allowedUpload(path.join(sibling, "secret.pdf"), [allowed]),
      {
        code: "path_not_allowed",
        message: /outside the allowed upload folders/,
        nextOperation: "doctor",
      },
    );
    await assert.rejects(allowedUpload("relative.pdf", [allowed]), {
      code: "path_not_allowed",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("registration is private, canonical, isolated by path, and never overwritten", async () => {
  const dir = await mkdtemp("/tmp/lw-reg-");
  const previous = process.env.LITEWAVE_HOME;
  process.env.LITEWAVE_HOME = path.join(dir, "state");
  try {
    const first = path.join(dir, "a", "app");
    const second = path.join(dir, "b", "app");
    await mkdir(first, { recursive: true });
    await mkdir(second, { recursive: true });
    const a = await register(first, "http://localhost:4444");
    const b = await register(second, "http://localhost:4444");
    assert.notEqual(a.id, b.id);
    assert.notEqual(a.socket, b.socket);
    assert.equal("token" in publicRegistration(a), false);
    assert.equal(
      (await stat(path.join(a.directory, "registration.json"))).mode & 0o777,
      0o600,
    );
    await assert.rejects(register(first, "http://localhost:5555"), {
      code: "already_registered",
    });
  } finally {
    if (previous === undefined) delete process.env.LITEWAVE_HOME;
    else process.env.LITEWAVE_HOME = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("unsupported capabilities and unbounded waits are rejected by the contract", () => {
  assert.equal(
    operationSchema.safeParse({
      method: "evaluate",
      requestId: "a",
      value: "document.cookie",
    }).success,
    false,
  );
  assert.equal(
    operationSchema.safeParse({
      method: "wait",
      requestId: "a",
      timeoutMs: 90_000,
    }).success,
    false,
  );
  assert.equal(
    operationSchema.safeParse({ method: "click", requestId: "" }).success,
    false,
  );
});

test("simultaneous duplicate IDs share persisted intent and journal failures disable mutations", async () => {
  const root = await mkdtemp("/tmp/lw-fault-");
  const dir = path.join(root, "journal");
  try {
    const journal = new Journal(dir);
    await journal.load();
    const op: Operation = { method: "click", requestId: "same-id", tabId: "t" };
    const accepted = await Promise.all([
      journal.accept(op),
      journal.accept(op),
    ]);
    assert.deepEqual(
      accepted.map((a) => a.duplicate),
      [false, true],
    );
    const disk = new Journal(dir);
    await disk.load();
    assert.equal(
      disk.actions.get("same-id")?.state,
      "rejected_before_dispatch",
    );
    await rename(dir, path.join(root, "saved"));
    await writeFile(dir, "not a directory");
    await assert.rejects(
      journal.transition(accepted[0]!.action, "dispatching"),
    );
    await assert.rejects(
      journal.accept({ ...op, requestId: "must-not-dispatch" }),
      { code: "storage_failure" },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
