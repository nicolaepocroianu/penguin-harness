/**
 * The recipe surface: the only files a candidate may change for its comparison to mean
 * anything. Everything else — the server's collectors, the harness, the checks, this bench —
 * must be byte-identical on both sides, or the answer is out_of_surface before any spend.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

/** What a recipe is made of: the authoring plugin's skills, its readme and its icon. */
export const RECIPE_SURFACE: readonly string[] = [
  "plugins/waf-authoring/skills/",
  "plugins/waf-authoring/README.md",
  "plugins/waf-authoring/icon.svg",
];

/**
 * The plugin's manifests, which a candidate may change in their `version` only: a script, a
 * dependency or a description there is out of surface. (A workspace package's install scripts
 * run when a recipe is built, so this is also what keeps a candidate from adding one.)
 */
export const VERSIONED_MANIFESTS: readonly string[] = [
  "plugins/waf-authoring/package.json",
  "plugins/waf-authoring/plugin.json",
];

/**
 * The stage prompt sources the surface also takes, once each run kind's prompt text lives in a
 * file of its own (decision 18). Until then a prompt edit is out of surface: the files that hold
 * a prompt also hold the code that collects and checks a run.
 */
export const PROMPT_SOURCES: readonly string[] = [];

/** Git's modes for a symbolic link and a submodule. */
const LINK_MODES = ["120000", "160000"];

export function inSurface(file: string): boolean {
  return (
    RECIPE_SURFACE.some((entry) =>
      entry.endsWith("/") ? file.startsWith(entry) : file === entry,
    ) || PROMPT_SOURCES.includes(file)
  );
}

export function git(repo: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd: repo, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error)
          reject(new Error(`git ${args[0]} failed: ${String(stderr || error.message).trim()}`));
        else resolve(stdout);
      },
    );
  });
}

/** The commit a revision names, or null when it names none. */
export async function commitOf(repo: string, revision: string): Promise<string | null> {
  try {
    return (await git(repo, ["rev-parse", "--verify", "--quiet", `${revision}^{commit}`])).trim();
  } catch {
    return null;
  }
}

export async function mergeBase(repo: string, a: string, b: string): Promise<string | null> {
  try {
    return (await git(repo, ["merge-base", a, b])).trim() || null;
  } catch {
    return null;
  }
}

/** Whether the checkout has anything not committed, untracked files included. */
export async function isDirty(repo: string): Promise<boolean> {
  return (await git(repo, ["status", "--porcelain", "--untracked-files=normal"])).trim() !== "";
}

/** The files head changes from base that are outside the recipe surface. */
export async function outsideSurface(repo: string, base: string, head: string): Promise<string[]> {
  // Each changed file: `:<mode before> <mode after> <blob> <blob> <status>`, then its path.
  const parts = (
    await git(repo, ["diff", "--raw", "-z", "--no-renames", "--no-abbrev", base, head])
  ).split("\0");
  const changed: { mode: string; file: string }[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const header = /^:\d{6} (\d{6}) /.exec(parts[i]!);
    if (header) changed.push({ mode: header[1]!, file: parts[i + 1]! });
  }
  const outside: string[] = [];
  for (const { mode, file } of changed) {
    // A link (or a submodule) points past the surface, wherever it sits.
    if (LINK_MODES.includes(mode)) {
      outside.push(`${file} (a link)`);
      continue;
    }
    if (inSurface(file)) continue;
    if (VERSIONED_MANIFESTS.includes(file)) {
      const [before, after] = await Promise.all([
        manifestWithoutVersion(repo, base, file),
        manifestWithoutVersion(repo, head, file),
      ]);
      if (before !== null && after !== null && isDeepStrictEqual(before, after)) continue;
    }
    outside.push(file);
  }
  return outside;
}

/** A JSON manifest at a commit with its `version` left out; null when it is not there or not JSON. */
async function manifestWithoutVersion(
  repo: string,
  sha: string,
  file: string,
): Promise<Record<string, unknown> | null> {
  try {
    const json: unknown = JSON.parse(await git(repo, ["show", `${sha}:${file}`]));
    if (!json || typeof json !== "object" || Array.isArray(json)) return null;
    const rest = { ...(json as Record<string, unknown>) };
    delete rest.version;
    return rest;
  } catch {
    return null;
  }
}

/**
 * The recipe's fingerprint at a commit: the surface's blobs, so commits that leave the surface
 * alone share one, and the runtime that answers with it.
 */
export async function recipeFingerprint(
  repo: string,
  sha: string,
  runtime: string,
): Promise<string> {
  const paths = [...RECIPE_SURFACE.map((prefix) => prefix.replace(/\/$/, "")), ...PROMPT_SOURCES];
  const tree = await git(repo, ["ls-tree", "-r", sha, "--", ...paths]);
  return createHash("sha256").update(`${runtime}\n${tree}`).digest("hex").slice(0, 16);
}
