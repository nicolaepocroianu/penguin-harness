/**
 * The folders a module's toolchain is looked up in: the module's own and, only when the module
 * is a package of an npm workspace (a monorepo such as waf-modules), each folder up to and
 * including that workspace's root. A module outside a workspace (a legacy checkout's) is never
 * walked up from, so a stray `node_modules` or `.nvmrc` in a parent folder or the home folder
 * plays no part in its build.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

/** The `workspaces` patterns a folder's package.json declares; null when it declares none. */
function workspacePatterns(dir: string): string[] | null {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  } catch {
    return null;
  }
  const declared = (manifest as { workspaces?: unknown } | null)?.workspaces;
  const list = Array.isArray(declared)
    ? declared
    : ((declared as { packages?: unknown } | undefined)?.packages ?? null);
  return Array.isArray(list)
    ? list.filter((each): each is string => typeof each === "string")
    : null;
}

/** Whether a workspace pattern such as `modules/waf-module-*` takes in this relative folder. */
function patternCovers(pattern: string, relative: string): boolean {
  const escaped = pattern
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .split("/")
    .map((part) =>
      part === "**"
        ? ".*"
        : part
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*/g, "[^/]*")
            .replace(/\?/g, "[^/]"),
    )
    .join("/");
  return new RegExp(`^${escaped}$`).test(relative);
}

/**
 * The module's folder, then (when an ancestor is an npm workspace root whose `workspaces` take
 * the module in) every folder up to and including that root, nearest first.
 */
export function moduleToolchainFolders(moduleRoot: string): string[] {
  const module = path.resolve(moduleRoot);
  const chain: string[] = [module];
  let dir = module;
  while (path.dirname(dir) !== dir) {
    dir = path.dirname(dir);
    chain.push(dir);
    const patterns = workspacePatterns(dir);
    if (!patterns) continue;
    const relative = path.relative(dir, module).split(path.sep).join("/");
    return patterns.some((pattern) => patternCovers(pattern, relative)) ? chain : [module];
  }
  return [module];
}
