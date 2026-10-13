/**
 * Starting a Penguin server for the bench: from a checkout's own tsx, on a home of the bench's,
 * with the system plumbing of this process's environment only, a random loopback port, and a
 * desktop token that is its only credential. The bench signs in with that token and talks to the
 * server over the routes an author's App uses; stopping it stops every process it started.
 */
import type { ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { killTree, plainEnv, spawnTree } from "./process-tree.js";
import { InfrastructureError } from "./types.js";

const BOOT_TIMEOUT_MS = 180_000;

/** A running server, signed in as its admin. */
export interface Server {
  origin: string;
  call<T>(method: string, route: string, body?: unknown): Promise<T>;
  /** The redirect a route answers with, or null when it answers otherwise. */
  location(route: string): Promise<string | null>;
  stop(): Promise<void>;
}

export interface BootOptions {
  /** The checkout the server runs from: its tsx and its packages/server. */
  worktree: string;
  /** The server's PENGUIN_HOME. */
  home: string;
  /** Where the server's port file and log go. */
  dir: string;
  /** Environment besides the plumbing and what the boot sets itself. */
  env?: Record<string, string>;
}

/** Starts a server from `worktree` on `home`, signed in as its admin; throws InfrastructureError. */
export async function bootServer(options: BootOptions): Promise<Server> {
  const { worktree, home, dir } = options;
  fs.mkdirSync(dir, { recursive: true });
  const portFile = path.join(dir, "server.port");
  fs.rmSync(portFile, { force: true });
  const token = randomBytes(24).toString("hex");
  const log = fs.openSync(path.join(dir, "server.log"), "a");
  const child = spawnTree(
    process.execPath,
    [path.join(worktree, "node_modules", "tsx", "dist", "cli.mjs"), path.join("src", "index.ts")],
    {
      cwd: path.join(worktree, "packages", "server"),
      env: plainEnv({
        ...options.env,
        PENGUIN_HOME: home,
        HOST: "127.0.0.1",
        PORT: "0",
        PENGUIN_PORT_FILE: portFile,
        PENGUIN_DESKTOP_TOKEN: token,
      }),
      stdio: ["ignore", log, log],
    },
  );
  fs.closeSync(log);
  let origin = "";
  const stop = async () => {
    if (origin) {
      await fetch(`${origin}/api/desktop/shutdown`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }).catch(() => {});
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 10_000)),
      ]);
    }
    await killTree(child);
  };
  try {
    const port = await waitForPort(child, portFile);
    // Bound to 127.0.0.1, a server answers its API on localhost and plays previews on
    // 127.0.0.1 (app.ts, the canonical-host guard): the play link comes back absolute.
    origin = `http://localhost:${port}`;
    const claimed = await fetch(`${origin}/api/auth/claim?token=${token}`, {
      redirect: "manual",
    });
    const cookie = /penguin_session=[^;]+/.exec(claimed.headers.get("set-cookie") ?? "")?.[0];
    if (!cookie) throw new InfrastructureError("The bench server did not sign the bench in.");
    return {
      origin,
      call: (method, route, body) => call(origin, cookie, method, route, body),
      location: async (route) => {
        const response = await fetch(`${origin}${route}`, {
          headers: { cookie },
          redirect: "manual",
        });
        return response.status >= 300 && response.status < 400
          ? response.headers.get("location")
          : null;
      },
      stop,
    };
  } catch (error) {
    await stop();
    const tail = readTail(path.join(dir, "server.log"));
    throw new InfrastructureError(`${message(error)}${tail ? `\n${tail}` : ""}`);
  }
}

async function waitForPort(child: ChildProcess, portFile: string): Promise<number> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`The bench server exited (${child.exitCode}).`);
    try {
      const port = Number(fs.readFileSync(portFile, "utf8").trim());
      if (Number.isInteger(port) && port > 0) return port;
    } catch {
      // Not written yet.
    }
    await sleep(250);
  }
  throw new Error("The bench server did not start in time.");
}

async function call<T>(
  origin: string,
  cookie: string,
  method: string,
  route: string,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${origin}${route}`, {
      method,
      headers: {
        cookie,
        origin,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    throw new InfrastructureError(
      `${method} ${route} did not reach the bench server: ${message(error)}`,
    );
  }
  const text = await response.text();
  if (!response.ok)
    throw new InfrastructureError(
      `${method} ${route} answered ${response.status}: ${text.slice(0, 500)}`,
    );
  return (text ? JSON.parse(text) : null) as T;
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readTail(file: string): string {
  try {
    return fs.readFileSync(file, "utf8").slice(-2000).trim();
  } catch {
    return "";
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
