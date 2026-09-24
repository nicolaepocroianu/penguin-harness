/**
 * Download and install one npm platform package as a runtime Penguin runs itself: metadata from
 * the registry, the tarball checked against the checksum the registry publishes, unpacked into a
 * temporary folder and renamed into `<runtimesDir>/<version>` in one step, then started once with
 * --version. A failed, cut-off or cancelled download never replaces a working version. Uses the
 * global fetch, which the server routes through its proxy settings (net/proxy.ts).
 */
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnTarget } from "@prismshadow/penguin-coding-agents";
import * as tar from "tar";
import { binaryFromManifest } from "./copilot-package.js";

export interface InstallRequest {
  registry: string;
  packageName: string;
  version: string;
  runtimesDir: string;
  signal?: AbortSignal;
  onProgress?: (received: number, total: number | null) => void;
}

export interface InstalledRuntime {
  version: string;
  dir: string;
  program: string;
  reportedVersion: string;
}

export class RuntimeInstallError extends Error {
  constructor(
    readonly kind: "network" | "integrity" | "start" | "cancelled",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "RuntimeInstallError";
  }
}

const INCOMING = ".incoming-";

export async function installRuntime(req: InstallRequest): Promise<InstalledRuntime> {
  await fs.mkdir(req.runtimesDir, { recursive: true });
  const incoming = path.join(req.runtimesDir, `${INCOMING}${randomUUID().slice(0, 8)}`);
  try {
    const meta = await fetchJson(`${req.registry}/${req.packageName}/${req.version}`, req.signal);
    const dist = (meta as { dist?: { tarball?: unknown; integrity?: unknown } }).dist;
    if (typeof dist?.tarball !== "string" || typeof dist.integrity !== "string") {
      throw new RuntimeInstallError(
        "network",
        "The registry did not describe the package download.",
      );
    }
    await fs.mkdir(incoming);
    const archive = path.join(incoming, "package.tgz");
    await download(dist.tarball, dist.integrity, archive, req);
    const unpacked = path.join(incoming, "unpacked");
    await fs.mkdir(unpacked);
    await tar.extract({ file: archive, cwd: unpacked, strip: 1 });
    await fs.rm(archive);
    const target = path.join(req.runtimesDir, req.version);
    await fs.rm(target, { recursive: true, force: true });
    await fs.rename(unpacked, target);
    const installed = await installedRuntime(req.runtimesDir, req.version);
    if (installed === null)
      throw new RuntimeInstallError("start", "The package did not unpack a program.");
    const reportedVersion = await versionOf(installed.program).catch(async (error: unknown) => {
      await fs.rm(target, { recursive: true, force: true });
      throw new RuntimeInstallError(
        "start",
        `The program did not start: ${(error as Error).message}`,
        {
          cause: error,
        },
      );
    });
    return { ...installed, reportedVersion };
  } catch (error) {
    if (req.signal?.aborted)
      throw new RuntimeInstallError("cancelled", "The download was cancelled.");
    if (error instanceof RuntimeInstallError) throw error;
    throw new RuntimeInstallError("network", (error as Error).message, { cause: error });
  } finally {
    await fs.rm(incoming, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** The runtime already unpacked for `version`, or null. Does not start it. */
export async function installedRuntime(
  runtimesDir: string,
  version: string,
): Promise<InstalledRuntime | null> {
  const dir = path.join(runtimesDir, version);
  try {
    const manifest = JSON.parse(
      await fs.readFile(path.join(dir, "package.json"), "utf8"),
    ) as unknown;
    const program = path.join(dir, binaryFromManifest(manifest));
    await fs.access(program);
    return { version, dir, program, reportedVersion: "" };
  } catch {
    return null;
  }
}

/** Remove leftover incoming folders and every version but `keepVersion`. Best-effort. */
export async function cleanRuntimes(
  runtimesDir: string,
  keepVersion: string | null,
): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(runtimesDir);
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter((name) => name !== keepVersion)
      .map((name) =>
        fs
          .rm(path.join(runtimesDir, name), { recursive: true, force: true })
          .catch(() => undefined),
      ),
  );
}

async function fetchJson(url: string, signal: AbortSignal | undefined): Promise<unknown> {
  const res = await fetch(url, {
    ...(signal ? { signal } : {}),
    headers: { accept: "application/json" },
  });
  if (!res.ok)
    throw new RuntimeInstallError("network", `The registry answered ${res.status} for ${url}.`);
  return res.json();
}

async function download(
  url: string,
  integrity: string,
  file: string,
  req: InstallRequest,
): Promise<void> {
  const res = await fetch(url, req.signal ? { signal: req.signal } : {});
  if (!res.ok || res.body === null) {
    throw new RuntimeInstallError("network", `The download answered ${res.status}.`);
  }
  const header = res.headers.get("content-length");
  const total = header !== null ? Number(header) : null;
  const [algorithm, expected] = integrity.split("-", 2) as [string, string];
  const hash = createHash(algorithm);
  const out = createWriteStream(file);
  let received = 0;
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk);
      received += chunk.length;
      if (!out.write(chunk))
        await new Promise<void>((resolve) => out.once("drain", () => resolve()));
      req.onProgress?.(received, total);
    }
  } finally {
    await new Promise<void>((resolve) => out.end(resolve));
  }
  if (total !== null && received !== total) {
    throw new RuntimeInstallError("network", "The download stopped before it finished.");
  }
  if (hash.digest("base64") !== expected) {
    throw new RuntimeInstallError(
      "integrity",
      "The download did not match its published checksum and was discarded.",
    );
  }
}

function versionOf(program: string): Promise<string> {
  const [file, args] = spawnTarget(program, ["--version"]);
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: 30_000,
        windowsHide: true,
        ...(file !== program ? { windowsVerbatimArguments: true } : {}),
      },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout.trim().split(/\r?\n/u)[0] ?? "");
      },
    );
  });
}
