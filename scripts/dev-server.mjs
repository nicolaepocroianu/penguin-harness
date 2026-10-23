#!/usr/bin/env node
/**
 * WorkbenchService watches and reloads the data root's plugins itself. Letting tsx
 * watch their dynamic imports also restarts the whole server during compilation.
 * tsx/chokidar needs absolute exclusions for dependencies outside its working directory.
 *
 * tsx watch gets no stdin. It reads stdin for its restart-on-Return key, and on Windows a
 * pipe with a read pending in one process blocks any other process that opens it. The
 * server opens it while booting (importing `node:process` as ESM reads every getter on
 * `process`, `stdin` included), so under `pnpm dev`, where concurrently hands each command
 * a stdin pipe, the server hung before it could listen.
 */
import { spawn } from "node:child_process";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRoot } from "@prismshadow/penguin-core";

const root = path.resolve(resolveRoot());
await mkdir(root, { recursive: true });
const roots = new Set([root, await realpath(root)]);
const child = spawn(
  process.execPath,
  [
    fileURLToPath(import.meta.resolve("tsx/cli")),
    "watch",
    ...[...roots].flatMap((dir) => ["--exclude", `${dir.replaceAll("\\", "/")}/**`]),
    ...process.argv.slice(2),
  ],
  { stdio: ["ignore", "inherit", "inherit"] },
);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", (error) => {
  console.error(`dev-server: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
