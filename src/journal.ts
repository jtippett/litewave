import path from "node:path";
import { readdir } from "node:fs/promises";
import { atomicJson, hash, privateDir, readJson } from "./storage.js";
import {
  AccessError,
  type ActionState,
  type Envelope,
  type Operation,
} from "./protocol.js";

export type Action = {
  requestId: string;
  parameterHash: string;
  state: ActionState;
  updatedAt: string;
  response: Envelope | null;
};
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export class Journal {
  readonly actions = new Map<string, Action>();
  private readonly accepting = new Map<string, Promise<void>>();
  healthy = true;
  constructor(readonly directory: string) {}
  async load() {
    await privateDir(this.directory);
    for (const name of await readdir(this.directory)) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const action = await readJson<Action>(path.join(this.directory, name));
      this.actions.set(action.requestId, action);
      if (
        ["accepted", "dispatching", "dispatched"].includes(action.state) &&
        !action.response
      ) {
        await this.transition(
          action,
          action.state === "accepted"
            ? "rejected_before_dispatch"
            : "outcome_unknown",
        );
      }
    }
  }
  async accept(op: Operation): Promise<{ action: Action; duplicate: boolean }> {
    if (!this.healthy)
      throw new AccessError(
        "storage_failure",
        "The journal is unavailable. Mutations are disabled; inspect local storage.",
        "doctor",
      );
    const parameterHash = hash(canonical(op));
    const prior = this.actions.get(op.requestId);
    if (prior) {
      if (prior.parameterHash !== parameterHash)
        throw new AccessError(
          "request_id_conflict",
          "This request ID was already used with different parameters.",
          "action_status",
        );
      await this.accepting.get(op.requestId);
      return { action: prior, duplicate: true };
    }
    const action: Action = {
      requestId: op.requestId,
      parameterHash,
      state: "accepted",
      updatedAt: new Date().toISOString(),
      response: null,
    };
    this.actions.set(op.requestId, action);
    const persisted = this.transition(action, "accepted");
    this.accepting.set(op.requestId, persisted);
    try {
      await persisted;
    } finally {
      this.accepting.delete(op.requestId);
    }
    return { action, duplicate: false };
  }
  async transition(
    action: Action,
    state: ActionState,
    response: Envelope | null = null,
  ) {
    const updated = {
      ...action,
      state,
      response,
      updatedAt: new Date().toISOString(),
    };
    try {
      await atomicJson(
        path.join(this.directory, `${hash(action.requestId)}.json`),
        updated,
      );
    } catch (error) {
      this.healthy = false;
      throw error;
    }
    Object.assign(action, updated);
  }
}
