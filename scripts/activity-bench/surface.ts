/**
 * The recipe surface: the only files a candidate may change for its comparison to mean
 * anything. Everything else — the server's collectors, the harness, the checks, this bench —
 * must be byte-identical on both sides, or the answer is out_of_surface before any spend.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";

/** What a recipe is made of: the authoring plugin. */
export const RECIPE_SURFACE: readonly string[] = ["plugins/waf-authoring/"];

/**
 * The stage prompt sources the surface also takes, once each run kind's prompt text lives in a
 * file of its own (decision 18). Until then a prompt edit is out of surface: the files that hold
 * a prompt also hold the code that collects and checks a run.
 */
export const PROMPT_SOURCES: readonly string[] = [];

export function inSurface(file: string): boolean {
  return RECIPE_SURFACE.some((prefix) => file.startsWith(prefix)) || PROMPT_SOURCES.includes(file);
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
  const changed = (await git(repo, ["diff", "--name-only", "--no-renames", base, head]))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return changed.filter((file) => !inSurface(file));
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
