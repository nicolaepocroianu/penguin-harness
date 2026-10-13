/**
 * A run's recipe: who answered, which bundled authoring files it was given, the harness and
 * Penguin's version. What the run was given is read from its workspace and matched by digest
 * against the bundled library, so every kind that stages a skill, a helper or a guide is covered
 * without saying which it stages.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { libraryPlugin } from "@prismshadow/penguin-core";
import { CODING_AGENT_PROVIDER } from "../coding-agents/session-runtime.js";
import { canonical, type ActivityRun } from "./domain.js";
import { HARNESS_VERSION } from "./acceptance-harness.js";
import type { LibraryFile, RecipeLibrary, RunRecipe } from "./outcome-types.js";
import { SKILLS_DIR } from "./waf-module.js";

/** The bundled plugins whose files a run kind stages into a workspace. */
const STAGED_PLUGINS = ["waf-authoring", "agent-development"] as const;

/** The most files of a workspace looked at for staged library files. */
const FILES_MAX = 2000;

export function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The id of a recipe: the digest of its canonical form. */
export function recipeId(recipe: RunRecipe): string {
  return sha256(JSON.stringify(canonical(recipe)));
}

/** The bundled library as first read; it is fixed for the life of the process. */
let bundled: LibraryFile[] | null = null;

/** Every file of the bundled plugins a run kind stages, with its digest; read once. */
export function bundledLibrary(): LibraryFile[] {
  bundled ??= readBundledLibrary();
  return bundled;
}

function readBundledLibrary(): LibraryFile[] {
  const files: LibraryFile[] = [];
  for (const name of STAGED_PLUGINS) {
    const plugin = libraryPlugin(name);
    if (!plugin) continue;
    for (const skill of plugin.skills)
      for (const [file, text] of Object.entries({ ...skill.files, "SKILL.md": skill.content })) {
        const bytes = Buffer.from(text, "utf8");
        files.push({
          plugin: plugin.name,
          version: plugin.version,
          skill: skill.name,
          skillVersion: skill.version,
          file,
          sha256: sha256(bytes),
          bytes: bytes.length,
        });
      }
  }
  return files;
}

/** Who answered a run, from what it was witnessed starting with. */
export function runtimeOf(
  session: { provider: string; modelId: string } | undefined,
  server: string | undefined,
): string {
  if (session)
    return session.provider === CODING_AGENT_PROVIDER
      ? `coding:${session.modelId}`
      : `agent:${session.provider}/${session.modelId}`;
  return server ?? "server";
}

/** The kinds handed the acceptance harness: a module run's player check, and a test run. */
function usesHarness(run: ActivityRun): boolean {
  return run.kind === "module" || run.kind === "test";
}

/**
 * The files a library file could have been staged as: the workspace's own files and those under
 * its skills folder, links not followed. Only paths whose size some library file has.
 */
function stagedCandidates(workspace: string, sizes: ReadonlySet<number>): string[] {
  const found: string[] = [];
  let seen = 0;
  const visit = (dir: string, recurse: boolean) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (++seen > FILES_MAX) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (recurse) visit(full, true);
      } else if (entry.isFile()) {
        const size = fs.statSync(full, { throwIfNoEntry: false })?.size;
        if (size !== undefined && sizes.has(size)) found.push(full);
      }
    }
  };
  visit(workspace, false);
  visit(path.join(workspace, SKILLS_DIR), true);
  return found;
}

/**
 * The library a run was given: every file in its workspace whose digest a bundled file has,
 * grouped by plugin and skill. Where two bundled files share a digest, the one at the same path
 * under the skills folder wins, then the one with the same name, then the first.
 */
export function stagedLibrary(workspace: string, library: readonly LibraryFile[]): RecipeLibrary[] {
  const byDigest = new Map<string, LibraryFile[]>();
  for (const file of library) {
    const same = byDigest.get(file.sha256) ?? [];
    same.push(file);
    byDigest.set(file.sha256, same);
  }
  const skillsRoot = path.join(workspace, SKILLS_DIR);
  const matched = new Map<string, LibraryFile>();
  for (const full of stagedCandidates(workspace, new Set(library.map((file) => file.bytes)))) {
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(full);
    } catch {
      continue;
    }
    const entries = byDigest.get(sha256(bytes));
    if (!entries) continue;
    const relative = path.relative(skillsRoot, full).split(path.sep).join("/");
    const sorted = [...entries].sort((a, b) =>
      `${a.plugin}/${a.skill}/${a.file}` < `${b.plugin}/${b.skill}/${b.file}` ? -1 : 1,
    );
    const entry =
      sorted.find((file) => `${file.skill}/${file.file}` === relative) ??
      sorted.find((file) => path.posix.basename(file.file) === path.basename(full)) ??
      sorted[0]!;
    matched.set(`${entry.plugin}/${entry.skill}/${entry.file}`, entry);
  }
  const plugins = new Map<string, { version: string; skills: Map<string, LibraryFile[]> }>();
  for (const file of matched.values()) {
    const plugin = plugins.get(file.plugin) ?? { version: file.version, skills: new Map() };
    plugin.skills.set(file.skill, [...(plugin.skills.get(file.skill) ?? []), file]);
    plugins.set(file.plugin, plugin);
  }
  return [...plugins.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([plugin, { version, skills }]) => ({
      plugin,
      version,
      skills: [...skills.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([name, files]) => ({
          name,
          version: files[0]!.skillVersion,
          sha256: sha256(
            files
              .map((file) => `${file.file} ${file.sha256}\n`)
              .sort()
              .join(""),
          ),
        })),
    }));
}

/** A run's recipe, from who answered and what its workspace was given. */
export function recipeOf(
  run: ActivityRun,
  runtime: string,
  workspace: string,
  library: readonly LibraryFile[],
  penguin: string,
): RunRecipe {
  return {
    runtime,
    library: stagedLibrary(workspace, library),
    ...(usesHarness(run) ? { harness: HARNESS_VERSION } : {}),
    penguin,
  };
}
