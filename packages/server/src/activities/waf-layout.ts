/**
 * The folder grammar of a WAF checkout and of the module repositories in it, as Loom laid
 * them out. Stored drafts, manifests and the checkout itself are in this layout, so every
 * path here is fixed.
 *
 *     <root>/
 *       framework/                         the framework the player and modules build with
 *       modules/navbar/                    the navigation bar every layout carries
 *       modules/<moduleFolder>/            one repository per product module (below)
 *       media/                             the media repository: a manifest's `media/<x>` is
 *         loom/<pc>/                       `<x>` in it; a product's sparse folder
 *           <pc>-<ref>/                    one ref's media (see ref-media.ts)
 *       waf-activity-data/                 the activity-data repository deploys publish to
 *
 * Product modules may also sit in a second modules root: a monorepo's `modules/` folder (such
 * as waf-modules), whose modules share one repository and one `node_modules` at its root. An
 * existing module folder is found there first, as Loom's module roots find it; a new one is
 * made in the checkout's own `modules/`.
 *
 *     <module>/
 *       definition.json
 *       configurations/<pc>-<ref>.json     the module documents a ref plays with
 *       assessments/<pc>-<ref>.json
 *       generated/<pc>/
 *         spec/                            the product's files (see ref-files.ts)
 *         refs/<pc>-<ref>/spec/            one ref's files
 *
 * A module repository is laid out the same wherever it is: in the checkout, or as a module
 * run's `module/`. Paths a module itself names (a scaffold's files, a run's required files)
 * are relative with forward slashes; paths on disk are joined to a root here and nowhere
 * else, and a folder or media path chosen by stored data is checked to stay inside it.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../http/errors.js";
import type { ModuleDocumentKind } from "./domain.js";
import { withinRoot } from "./sandbox-paths.js";
import type { WafRepoId } from "./waf-workspace-types.js";

/** Where each shared repository sits in a checkout. */
export const WAF_REPO_PATHS: Readonly<Record<WafRepoId, string>> = {
  framework: "framework",
  navbar: "modules/navbar",
  media: "media",
  activityData: "waf-activity-data",
};

/** The navigation bar module's folder under `modules/`. */
export const NAVBAR_FOLDER = "navbar";

const MODULES_DIR = "modules";
const MEDIA_PREFIX = "media/";

/** A module folder's short name (`waf-module-abc` → `abc`), which its deploy branch is named from. */
export function moduleShortName(moduleFolder: string): string {
  const folder = moduleFolder.trim();
  for (const prefix of ["waf-module-", "wafmodule-"])
    if (folder.startsWith(prefix)) return folder.slice(prefix.length);
  return folder;
}

/** Loom's folder name for one ref: `<pc>-<ref>`. */
export function refFolderName(productCode: string, refNum: number): string {
  return `${productCode}-${refNum}`;
}

/**
 * The ref number a folder name carries, or null when it is not one of this product's.
 *
 * A product code may itself contain hyphens and digits, so the prefix has to match exactly
 * rather than being split on the last hyphen.
 */
export function parseRefFolderName(productCode: string, name: string): number | null {
  const prefix = `${productCode}-`;
  if (!name.startsWith(prefix)) return null;
  const rest = name.slice(prefix.length);
  if (!/^(?:0|[1-9][0-9]*)$/.test(rest)) return null;
  const refNum = Number(rest);
  return Number.isSafeInteger(refNum) && refNum >= 0 ? refNum : null;
}

/** `generated/<pc>/refs/<pc>-<ref>/spec`, as a module names it. */
export function refSpecPath(productCode: string, refNum: number): string {
  return `generated/${productCode}/refs/${refFolderName(productCode, refNum)}/spec`;
}

/**
 * A module document as the module names it: `configurations/<pc>-<ref>.json`,
 * `assessments/<pc>-<ref>.json`, the module's one `definition.json`, or the product's
 * `generated/<pc>/spec/state-machine.json`, shared by every ref, as Loom keeps it.
 */
export function moduleDocumentPath(
  kind: ModuleDocumentKind,
  productCode: string,
  refNum: number,
): string {
  if (kind === "definition") return "definition.json";
  if (kind === "stateMachine") return `generated/${productCode}/spec/state-machine.json`;
  const folder = kind === "configuration" ? "configurations" : "assessments";
  return `${folder}/${productCode}-${refNum}.json`;
}

/** `media/loom/<pc>/<pc>-<ref>`: a ref's media folder, as a manifest names it. */
export function refMediaFolder(productCode: string, refNum: number): string {
  return `${MEDIA_PREFIX}${mediaSparsePath(productCode)}/${refFolderName(productCode, refNum)}`;
}

/** `loom/<pc>`: the media repository folder a product's media lives in, checked out sparsely. */
export function mediaSparsePath(productCode: string): string {
  return `loom/${productCode}`;
}

/** A manifest's `media/...` path as a path inside the media repository; null for any other. */
export function mediaRepoPath(reference: string): string | null {
  return reference.startsWith(MEDIA_PREFIX) && reference.length > MEDIA_PREFIX.length
    ? reference.slice(MEDIA_PREFIX.length)
    : null;
}

/** A path inside the media repository as a manifest names it: `media/<path>`. */
export function mediaReference(repoPath: string): string {
  return `${MEDIA_PREFIX}${repoPath}`;
}

/** One module repository, at whatever root it has. */
export class ModuleLayout {
  constructor(readonly root: string) {}

  /** `<module>/generated`: one folder per product code. */
  get generatedDir(): string {
    return path.join(this.root, "generated");
  }

  /** `<module>/generated/<pc>`. */
  productDir(productCode: string): string {
    return path.join(this.generatedDir, productCode);
  }

  /** `<module>/generated/<pc>/spec`: the product's own files. */
  productSpecDir(productCode: string): string {
    return path.join(this.productDir(productCode), "spec");
  }

  /** `<module>/generated/<pc>/refs`: one folder per ref. */
  refsDir(productCode: string): string {
    return path.join(this.productDir(productCode), "refs");
  }

  /** `<module>/generated/<pc>/refs/<pc>-<ref>`: the ref's folder, which its number names. */
  refDir(productCode: string, refNum: number): string {
    return path.join(this.refsDir(productCode), refFolderName(productCode, refNum));
  }

  /** `<ref>/spec`, where every file of the ref's draft is. */
  refSpecDir(productCode: string, refNum: number): string {
    return path.join(this.root, refSpecPath(productCode, refNum));
  }

  /** A module document on disk (see moduleDocumentPath). */
  document(kind: ModuleDocumentKind, productCode: string, refNum: number): string {
    return path.join(this.root, moduleDocumentPath(kind, productCode, refNum));
  }
}

/** A module folder and one product code under its `generated/`. */
export interface ModuleProductPlace {
  moduleFolder: string;
  productCode: string;
}

/**
 * The folders in `dir`, by name, a link to a folder (a symlink, or a junction on Windows)
 * included; none when `dir` cannot be read.
 */
export async function childFolders(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const folders = await Promise.all(
    entries.map(async (entry) => {
      if (entry.isDirectory()) return entry.name;
      if (!entry.isSymbolicLink()) return null;
      const target = await fs.stat(path.join(dir, entry.name)).catch(() => null);
      return target?.isDirectory() ? entry.name : null;
    }),
  );
  return folders.filter((name): name is string => name !== null).sort();
}

/**
 * The monorepo modules folders each checkout's modules may also be in, by checkout root. The
 * WAF workspace sets them whenever it hands out its root (see `WafWorkspace.root`), so every
 * `new WafLayout(root)` of that root sees the same roots.
 */
const monorepoRoots = new Map<string, readonly string[]>();

export function setMonorepoModuleRoots(wafRoot: string, roots: readonly string[]): void {
  const key = path.resolve(wafRoot);
  if (roots.length)
    monorepoRoots.set(
      key,
      roots.map((root) => path.resolve(root)),
    );
  else monorepoRoots.delete(key);
}

/** One WAF checkout, at its root. */
export class WafLayout {
  /** Monorepo modules folders searched before `<root>/modules`. */
  readonly monorepoModuleRoots: readonly string[];

  constructor(
    readonly root: string,
    monorepoModuleRoots?: readonly string[],
  ) {
    this.monorepoModuleRoots =
      monorepoModuleRoots?.map((dir) => path.resolve(dir)) ??
      monorepoRoots.get(path.resolve(root)) ??
      [];
  }

  /** A shared repository's directory. */
  repo(id: WafRepoId): string {
    return path.join(this.root, WAF_REPO_PATHS[id]);
  }

  /** `<root>/modules`. */
  get modulesDir(): string {
    return path.join(this.root, MODULES_DIR);
  }

  /** Every modules root, in the order a module folder is looked for: monorepos first. */
  get moduleRoots(): string[] {
    return [...this.monorepoModuleRoots, this.modulesDir];
  }

  /**
   * A module folder's directory: the first modules root that has it, else `<root>/modules/
   * <folder>`, where a new module is made. Null when the folder would leave its root.
   */
  moduleDir(folder: string): string | null {
    if (!withinRoot(this.modulesDir, folder)) return null;
    for (const root of this.monorepoModuleRoots) {
      const dir = withinRoot(root, folder);
      if (dir && existsSync(dir)) return dir;
    }
    return path.join(this.modulesDir, folder);
  }

  /**
   * Whether a module folder is in a monorepo modules root: it shares that monorepo's
   * repository, so WAF Harness neither clones it nor runs git in it.
   */
  inMonorepo(folder: string): boolean {
    const dir = this.moduleDir(folder);
    return (
      dir !== null && this.monorepoModuleRoots.some((root) => withinRoot(root, folder) === dir)
    );
  }

  /** The module repository in `modules/<folder>`; 400 `module_folder_invalid` when it would leave. */
  module(folder: string): ModuleLayout {
    const dir = this.moduleDir(folder);
    if (!dir) throw new HttpError(400, "module_folder_invalid", "Not a module folder name.");
    return new ModuleLayout(dir);
  }

  /** A manifest's `media/...` path as a file in the media repository; null when it would leave. */
  mediaFile(reference: string): string | null {
    const inRepo = mediaRepoPath(reference);
    return inRepo === null ? null : withinRoot(this.repo("media"), inRepo);
  }

  /**
   * Every product in every modules root, by folder then code. One module folder may hold
   * several product codes; a folder without `generated/` is not a module and holds none. A
   * folder in two roots is listed once, from the root `moduleDir` finds it in.
   */
  async products(): Promise<ModuleProductPlace[]> {
    const moduleFolders = new Set<string>();
    for (const root of this.moduleRoots)
      for (const folder of await childFolders(root)) moduleFolders.add(folder);
    const found: ModuleProductPlace[] = [];
    for (const moduleFolder of [...moduleFolders].sort())
      for (const productCode of await childFolders(this.module(moduleFolder).generatedDir))
        found.push({ moduleFolder, productCode });
    return found;
  }
}

/** Loom's WAF checkout convention; discovery only walks ancestors, never the disk. */
export async function findWafRoot(
  start = process.cwd(),
  configured = process.env.WAF_ROOT_DIR,
): Promise<string | null> {
  let current = path.resolve(configured || start);
  for (;;) {
    try {
      const entries = await Promise.all(
        ["framework/package.json", "framework/src", MODULES_DIR, "media"].map((name) =>
          fs.stat(path.join(current, name)),
        ),
      );
      if (entries[0]?.isFile() && entries.slice(1).every((entry) => entry.isDirectory()))
        return await fs.realpath(current);
    } catch {
      /* An ancestor may be the workspace root. */
    }
    if (configured || path.dirname(current) === current) return null;
    current = path.dirname(current);
  }
}
