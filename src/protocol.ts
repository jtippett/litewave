import { z } from "zod";

export const VERSION = "1" as const;
export const locatorSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("role"),
      role: z.string().min(1),
      name: z.string(),
    })
    .strict(),
  z.object({ kind: z.literal("testId"), value: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("css"), value: z.string().min(1) }).strict(),
]);
export const operationSchema = z
  .object({
    method: z.enum([
      "status",
      "tabs",
      "snapshot",
      "screenshot",
      "action_status",
      "downloads",
      "navigate",
      "click",
      "fill",
      "select",
      "check",
      "keypress",
      "hover",
      "upload",
      "wait",
      "stop",
    ]),
    requestId: z.string().min(1).max(200),
    tabId: z.string().optional(),
    revision: z.number().int().nonnegative().optional(),
    target: locatorSchema.optional(),
    url: z.string().url().optional(),
    value: z.string().max(100_000).optional(),
    values: z.array(z.string()).max(100).optional(),
    checked: z.boolean().optional(),
    paths: z.array(z.string()).max(20).optional(),
    actionId: z.string().max(200).optional(),
    fullPage: z.boolean().optional(),
    timeoutMs: z.number().int().min(1).max(30_000).optional(),
    state: z.enum(["visible", "hidden"]).optional(),
    postcondition: z
      .object({
        target: locatorSchema,
        state: z.enum(["visible", "hidden"]).default("visible"),
      })
      .strict()
      .optional(),
  })
  .strict();
export type Operation = z.infer<typeof operationSchema>;
export type Target = z.infer<typeof locatorSchema>;
export type ActionState =
  | "accepted"
  | "dispatching"
  | "dispatched"
  | "postcondition_met"
  | "rejected_before_dispatch"
  | "outcome_unknown";
export type Envelope = {
  protocolVersion: typeof VERSION;
  requestId: string;
  sessionId: string | null;
  tabId: string | null;
  documentRevision: number | null;
  durationMs: number;
  status: "ok" | "error" | ActionState;
  result: unknown;
  warnings: string[];
  error: null | {
    code: string;
    message: string;
    dispatchOccurred: boolean | "unknown";
    nextOperation: string;
  };
};
export class AccessError extends Error {
  constructor(
    public code: string,
    message: string,
    public nextOperation = "status",
  ) {
    super(message);
  }
}
export const mutationMethods = new Set([
  "navigate",
  "click",
  "fill",
  "select",
  "check",
  "keypress",
  "hover",
  "upload",
]);
export function failure(
  id: string,
  error: unknown,
  sessionId: string | null = null,
): Envelope {
  const known = error instanceof AccessError;
  return {
    protocolVersion: VERSION,
    requestId: id,
    sessionId,
    tabId: null,
    documentRevision: null,
    durationMs: 0,
    status: "error",
    result: null,
    warnings: [],
    error: {
      code: known ? error.code : "internal_error",
      message: known
        ? error.message
        : "Operation failed; inspect the local worker log.",
      dispatchOccurred: false,
      nextOperation: known ? error.nextOperation : "doctor",
    },
  };
}
