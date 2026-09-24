export { register, registration, publicRegistration } from "./storage.js";
export type { Registration } from "./storage.js";
export { openBrowser, doctor } from "./supervisor.js";
export { rpc } from "./transport.js";
export { operationSchema, locatorSchema, AccessError } from "./protocol.js";
export type { Operation, Envelope, Target } from "./protocol.js";
export {
  callPhoenix,
  setupPhoenix,
  resolveRuntime,
  phoenixTools,
} from "./phoenix.js";
export type {
  PhoenixTool,
  PhoenixResult,
  PhoenixConnection,
  RuntimeTarget,
} from "./phoenix.js";
export { projectKey, runtimeSocketPath, projectDirectory } from "./storage.js";
export type { RuntimeDescriptor } from "./storage.js";

export type { BrowserOpenOptions } from "./profile.js";
