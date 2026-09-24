#!/usr/bin/env node
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { AccessError, failure, operationSchema } from "./protocol.js";
import {
  register,
  registration,
  publicRegistration,
  uploadPolicy,
} from "./storage.js";
import { openBrowser, doctor } from "./supervisor.js";
import { rpc } from "./transport.js";
import { mcp } from "./mcp.js";
import { callPhoenix, setupPhoenix, type PhoenixTool } from "./phoenix.js";

const HELP = `Litewave — local browser access (alpha)

  litewave init --project PATH --app URL [--upload-root PATH ...]
  litewave browser open --project PATH [--headless] [--fresh-profile [--storage-state PATH]]
  litewave status --project PATH
  litewave doctor --project PATH
  litewave call --project PATH --json '{"method":"tabs","requestId":"tabs-1"}'
  litewave mcp --project PATH
  litewave stop --project PATH
  litewave phoenix setup --project PATH
  litewave phoenix status --project PATH
  litewave phoenix call --project PATH --tool NAME --json '{...}'

Upload folders are optional: browser uploads send local files to the app, so
--upload-root limits which files the agent can select. Choose an existing folder
containing files you intend to upload; a dedicated uploads folder is optional.
Without one, browsing, downloads, and Phoenix tools still work. Litewave does not
create an uploads folder or grant upload access automatically.

init never overwrites a registration. browser open is the only command that
launches Chromium. Closing a CLI/MCP connection leaves the browser running.
--fresh-profile explicitly creates a separate browser profile and keeps the old one.
Sign in again, or import an explicitly supplied Playwright storage-state file with
--storage-state PATH. Treat that file as a password; it contains authentication.
Use --help for this text. See README.md for installation and action examples.`;
async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      project: { type: "string" },
      app: { type: "string" },
      "upload-root": { type: "string", multiple: true },
      json: { type: "string" },
      headless: { type: "boolean" },
      "fresh-profile": { type: "boolean" },
      "storage-state": { type: "string" },
      help: { type: "boolean" },
      tool: { type: "string" },
    },
  });
  if (values.help || positionals.length === 0) {
    console.log(HELP);
    return;
  }
  const project = values.project ?? process.cwd();
  const command = positionals.join(" ");
  if (command === "init") {
    if (!values.app)
      throw new AccessError("invalid_request", "--app URL is required.");
    const r = await register(project, values.app, values["upload-root"]);
    console.log(
      JSON.stringify(
        {
          registration: publicRegistration(r),
          uploads: uploadPolicy(r),
          mcpServers: {
            litewave: {
              command: process.execPath,
              args: [
                fileURLToPath(import.meta.url),
                "mcp",
                "--project",
                r.project,
              ],
              ...(process.env.LITEWAVE_HOME
                ? { env: { LITEWAVE_HOME: process.env.LITEWAVE_HOME } }
                : {}),
            },
          },
        },
        null,
        2,
      ),
    );
    return;
  }
  const r = await registration(project);
  if (command.startsWith("phoenix ")) {
    const result =
      command === "phoenix setup"
        ? await setupPhoenix(r)
        : command === "phoenix status"
          ? await callPhoenix(r, "phoenix_health")
          : command === "phoenix call"
            ? await callPhoenix(
                r,
                values.tool as PhoenixTool,
                JSON.parse(values.json ?? "{}"),
              )
            : (() => {
                throw new AccessError(
                  "invalid_request",
                  "Unknown Phoenix command.",
                );
              })();
    console.log(JSON.stringify(result, null, 2));
    if ("error" in result && result.error) process.exitCode = 1;
    return;
  }
  if (command === "mcp") {
    await mcp(r);
    return;
  }
  const result =
    command === "browser open"
      ? await openBrowser(r, values.headless, {
          freshProfile: values["fresh-profile"],
          storageState: values["storage-state"],
        })
      : command === "doctor"
        ? await doctor(r)
        : ["status", "stop"].includes(command)
          ? await rpc(r, {
              method: command as "status" | "stop",
              requestId: randomUUID(),
            })
          : command === "call"
            ? await rpc(
                r,
                operationSchema.parse(JSON.parse(values.json ?? "{}")),
              )
            : (() => {
                throw new AccessError(
                  "invalid_request",
                  "Unknown command. Run litewave --help.",
                );
              })();
  console.log(JSON.stringify(result, null, 2));
  if ("error" in result && result.error) process.exitCode = 1;
}
main().catch((error) => {
  const result = failure("cli", error);
  if (result.error?.code === "connection_lost") {
    result.error.dispatchOccurred = "unknown";
    result.status = "outcome_unknown";
  }
  console.error(JSON.stringify(result, null, 2));
  process.exitCode = 1;
});
