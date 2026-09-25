import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  stat,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { AccessError } from "./protocol.js";

export const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
// Same normalisation as Elixir's Path.expand: a leading ~ is the home
// directory and a relative path resolves against the working directory.
export const home = () => {
  const configured = process.env.LITEWAVE_HOME;
  if (configured === undefined) return path.join(homedir(), ".litewave");
  const expanded =
    configured === "~" || configured.startsWith("~/")
      ? path.join(homedir(), configured.slice(1))
      : configured;
  return path.resolve(expanded);
};
// Every command canonicalises --project here, so a mistyped path is an
// invalid_request rather than an unexplained filesystem error.
export async function canonicalProject(project: string): Promise<string> {
  return realpath(project).catch((error: NodeJS.ErrnoException) => {
    throw new AccessError(
      "invalid_request",
      error.code === "ENOENT"
        ? `Project directory does not exist: ${project}`
        : `Project directory is not accessible: ${project}`,
    );
  });
}
export const projectKey = (canonical: string) => hash(canonical).slice(0, 24);
export const projectDirectory = (canonical: string) =>
  path.join(home(), "projects", projectKey(canonical));
export const runtimeSocketPath = (canonical: string) =>
  path.join(home(), "run", `p${projectKey(canonical).slice(0, 16)}.sock`);
export type RuntimeDescriptor = {
  version: 1;
  project: string;
  project_id: string;
  runtime_id: string;
  os_pid: number;
  socket: string;
  started_at: string;
  capabilities: string[];
};
export async function exists(file: string): Promise<boolean> {
  return lstat(file).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
}
export async function privateDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const info = await lstat(dir);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid?.()
  ) {
    throw new AccessError(
      "permission_denied",
      "Litewave storage must be a directory owned by the current user.",
    );
  }
  // Reject any symlink component, while allowing macOS /var and /tmp aliases in the parent path.
  const parent = await realpath(path.dirname(dir));
  if ((await realpath(dir)) !== path.join(parent, path.basename(dir)))
    throw new AccessError("path_not_allowed", "Storage symlink rejected.");
  await chmod(dir, 0o700);
}
export async function readJson<T>(file: string): Promise<T> {
  const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await fd.stat();
    if (
      !info.isFile() ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o077) !== 0
    ) {
      throw new AccessError(
        "permission_denied",
        "State files must be private and owned by the current user.",
      );
    }
    return JSON.parse(await fd.readFile("utf8")) as T;
  } finally {
    await fd.close();
  }
}
export async function atomicJson(file: string, value: unknown): Promise<void> {
  await privateDir(path.dirname(file));
  const temp = `${file}.${randomUUID()}.partial`;
  const fd = await open(temp, "wx", 0o600);
  try {
    await fd.writeFile(JSON.stringify(value, null, 2) + "\n");
    await fd.sync();
  } finally {
    await fd.close();
  }
  await rename(temp, file);
  const parent = await open(path.dirname(file), "r");
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}
export type Registration = {
  version: 1;
  id: string;
  project: string;
  app: string;
  origins: string[];
  uploadRoots: string[];
  directory: string;
  socket: string;
  token: string;
};
export function publicRegistration(r: Registration) {
  const { token: _token, ...publicFields } = r;
  return publicFields;
}
export function uploadPolicy(r: Registration) {
  return {
    state: r.uploadRoots.length ? "configured" : "not_configured",
    roots: r.uploadRoots,
    explanation:
      "Browser uploads can send local files to the app. Allowed folders limit which files the agent can select. Use an existing folder containing files you intend to upload; a dedicated uploads folder is optional. Browsing, downloads, and Phoenix tools do not require one.",
    configurationFile: path.join(r.directory, "registration.json"),
    setup:
      "For a new registration, pass --upload-root /absolute/path/to/existing-folder to init (repeat for multiple folders). For an existing registration, see README.md: Upload folder setup. No folder or permission is added automatically.",
  };
}
export async function register(
  project: string,
  app: string,
  roots: string[] = [],
): Promise<Registration> {
  const canonical = await canonicalProject(project);
  const url = new URL(app);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new AccessError(
      "permission_denied",
      "App must be an HTTP(S) URL without credentials.",
    );
  await privateDir(home());
  const base = home();
  const directory = projectDirectory(canonical);
  await privateDir(path.join(base, "projects"));
  await privateDir(directory);
  const file = path.join(directory, "registration.json");
  // Exclusive creation also arbitrates simultaneous init calls; never overwrite.
  const id = randomUUID();
  await privateDir(path.join(base, "run"));
  const socket = path.join(base, "run", `${id.slice(0, 16)}.sock`);
  if (Buffer.byteLength(socket) > 100)
    throw new AccessError(
      "path_not_allowed",
      "LITEWAVE_HOME is too long for a Unix socket. Choose a shorter path.",
    );
  const r: Registration = {
    version: 1,
    id,
    project: canonical,
    app: url.href,
    origins: [url.origin],
    uploadRoots: await Promise.all(roots.map((p) => realpath(p))),
    directory,
    socket,
    token: randomUUID() + randomUUID(),
  };
  const fd = await open(file, "wx", 0o600).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST")
        throw new AccessError(
          "already_registered",
          "Project already registered; init does not overwrite configuration.",
          "status",
        );
      throw error;
    },
  );
  try {
    await fd.writeFile(JSON.stringify(r, null, 2) + "\n");
    await fd.sync();
  } finally {
    await fd.close();
  }
  return r;
}
export async function registration(project: string): Promise<Registration> {
  const canonical = await canonicalProject(project);
  const r = await readJson<Registration>(
    path.join(projectDirectory(canonical), "registration.json"),
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT")
      throw new AccessError(
        "not_registered",
        "This project is not registered. Run litewave init --project PATH (add --app URL if no Litewave runtime is running), then litewave browser open --project PATH.",
        "init",
      );
    throw error;
  });
  if (r.project !== canonical)
    throw new AccessError(
      "permission_denied",
      "Project identity does not match registration.",
    );
  return r;
}
export async function allowedUpload(file: string, roots: string[]) {
  if (roots.length === 0)
    throw new AccessError(
      "path_not_allowed",
      "No upload folders are configured. Browser uploads send local files to the app, so choose an existing folder containing files you intend to upload. A dedicated uploads folder is optional. Run doctor for configuration details; browsing, downloads, and Phoenix tools still work.",
      "doctor",
    );
  if (!path.isAbsolute(file))
    throw new AccessError("path_not_allowed", "Upload paths must be absolute.");
  const resolved = await realpath(file);
  const canonicalRoots = await Promise.all(roots.map((root) => realpath(root)));
  if (
    !canonicalRoots.some((root) => {
      const rel = path.relative(root, resolved);
      return (
        rel !== ".." &&
        !rel.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(rel)
      );
    })
  ) {
    throw new AccessError(
      "path_not_allowed",
      "This file is outside the allowed upload folders. Choose a file within those folders, or explicitly update the upload configuration. Run doctor to see the configured folders and setup guidance.",
      "doctor",
    );
  }
  const info = await stat(resolved);
  if (!info.isFile())
    throw new AccessError("path_not_allowed", "Upload must be a regular file.");
  return { path: resolved, name: path.basename(resolved), size: info.size };
}
