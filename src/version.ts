import { createRequire } from "node:module";

// Compiled to dist/src/, so package.json is two levels up. Read at runtime so
// a version bump in package.json is the only edit a release needs.
const require = createRequire(import.meta.url);
export const packageVersion: string = (
  require("../../package.json") as { version: string }
).version;
