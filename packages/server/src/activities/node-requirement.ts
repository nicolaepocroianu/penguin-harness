/**
 * The Node a module asks for, against the Node that builds it.
 *
 * WAF modules pin their toolchain: `.nvmrc` names one version (a monorepo's sits at its root),
 * and `engines.node` in package.json a range. Penguin installs no Node and builds with the one
 * the server runs, so when they disagree it says so, rather than build quietly with another.
 * Only what WAF writes is understood: versions, `>=`/`>`/`<=`/`<`/`=` comparators, `^`, `~`,
 * x-ranges and `||`. Anything else (an nvm alias such as `lts/*`) is not judged.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type Version = [number, number, number];

/** A version as numbers, with the parts it leaves out (or writes as x) null. */
function parsePartial(text: string): [number, number | null, number | null] | null {
  const match = /^v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/i.exec(text.trim());
  if (!match) return null;
  const part = (value: string | undefined) =>
    value === undefined || !/^\d+$/.test(value) ? null : Number(value);
  return [Number(match[1]), part(match[2]), part(match[3])];
}

function compare(a: Version, b: Version): number {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

/** Whether `version` satisfies one comparator such as `>=24.19.0`, `^24`, `24.x` or `24.19.0`. */
function satisfiesOne(version: Version, comparator: string): boolean | null {
  const match = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(comparator);
  if (!match) return null;
  const op = match[1] ?? "";
  const partial = parsePartial(match[2]!);
  if (!partial) return null;
  const [major, minor, patch] = partial;
  const low: Version = [major, minor ?? 0, patch ?? 0];
  // The version just past what the partial covers: 24 → 25.0.0, 24.19 → 24.20.0.
  const past: Version =
    minor === null
      ? [major + 1, 0, 0]
      : patch === null
        ? [major, minor + 1, 0]
        : [major, minor, patch + 1];
  const at = compare(version, low);
  switch (op) {
    case ">=":
      return at >= 0;
    case ">":
      return compare(version, past) >= 0;
    case "<=":
      return compare(version, past) < 0;
    case "<":
      return at < 0;
    case "^":
      return at >= 0 && version[0] === major;
    case "~":
      return (
        at >= 0 && compare(version, minor === null ? [major + 1, 0, 0] : [major, minor + 1, 0]) < 0
      );
    default:
      return at >= 0 && compare(version, past) < 0;
  }
}

/** Whether `version` satisfies an npm-style range; null when the range is not understood. */
export function satisfiesNodeRange(version: string, range: string): boolean | null {
  const parsed = parsePartial(version);
  if (!parsed || parsed[1] === null || parsed[2] === null) return null;
  const at: Version = [parsed[0], parsed[1], parsed[2]];
  let understood = false;
  for (const alternative of range.split("||")) {
    const comparators = alternative
      .trim()
      .replace(/(>=|<=|>|<|=|\^|~)\s+/g, "$1")
      .split(/\s+/)
      .filter(Boolean);
    if (!comparators.length || comparators.includes("*")) return true;
    const results = comparators.map((comparator) => satisfiesOne(at, comparator));
    if (results.includes(null)) continue;
    understood = true;
    if (results.every(Boolean)) return true;
  }
  return understood ? false : null;
}

function readText(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** The nearest `.nvmrc` from the module up to its npm workspace's root, with where it is. */
function nearestNvmrc(moduleRoot: string): { file: string; version: string } | null {
  let dir = path.resolve(moduleRoot);
  for (;;) {
    const file = path.join(dir, ".nvmrc");
    const text = existsSync(file) ? readText(file)?.trim() : undefined;
    if (text) return { file, version: text.split(/\s+/)[0]! };
    const manifest = readText(path.join(dir, "package.json"));
    if ((manifest && /"workspaces"\s*:/.test(manifest)) || path.dirname(dir) === dir) return null;
    dir = path.dirname(dir);
  }
}

/**
 * A line for the build log when the module asks for another Node than `running` (the server's
 * `process.version`), naming what it asks for and where; null when it asks for none, or this one.
 */
export function nodeRequirementNote(moduleRoot: string, running: string): string | null {
  const wants: string[] = [];
  const nvmrc = nearestNvmrc(moduleRoot);
  if (nvmrc && satisfiesNodeRange(running, nvmrc.version) === false)
    wants.push(`${nvmrc.version} (${path.relative(moduleRoot, nvmrc.file) || ".nvmrc"})`);
  let engines: unknown = null;
  try {
    engines = (
      JSON.parse(readText(path.join(moduleRoot, "package.json")) ?? "null") as {
        engines?: { node?: unknown };
      } | null
    )?.engines?.node;
  } catch {
    engines = null;
  }
  if (typeof engines === "string" && satisfiesNodeRange(running, engines) === false)
    wants.push(`${engines} (engines in package.json)`);
  if (!wants.length) return null;
  return `Warning: this module asks for Node ${wants.join(" and ")}, but Penguin builds it with the server's Node ${running}. Penguin does not install Node; run the server on the Node the module asks for if the build fails or behaves differently.`;
}
