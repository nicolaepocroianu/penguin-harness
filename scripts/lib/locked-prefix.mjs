/**
 * The builtin prefix's third-party packages, held to what pnpm-lock.yaml resolves.
 *
 * scripts/build-plugins.mjs installs the builtin plugins with npm, and npm resolves every `^`
 * range in a native dependency's tree against the registry at build time — so the prefix ran a
 * DSH chain (cordis, cosmokit, schemastery, ...) newer than the one the workspace was tested
 * with, and two builds a day apart could ship different code under the same lockfile. This
 * module reads the closure of the plugins' NATIVE_DEPENDENCIES from the lockfile, hands it to npm
 * as `overrides` in the prefix's own manifest (an override pins every instance of a package,
 * transitive ones included), and afterwards compares npm's tree with the lockfile by version and
 * by tarball integrity, so a drift, a republished tarball or a package the lockfile never named
 * fails the build instead of shipping.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/** The parsed pnpm-lock.yaml under `root` (`yaml` comes from core, the root declares none). */
export function readPnpmLock(root) {
  const yaml = createRequire(path.join(root, "packages", "core", "package.json"))("yaml");
  return yaml.parse(fs.readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8"));
}

/** Whether an `os`/`cpu` list (`["linux"]`, `["!win32"]`) admits `value`; no list admits all. */
function admits(list, value) {
  if (!list) return true;
  if (list.includes(`!${value}`)) return false;
  return list.includes(value) || list.every((v) => v.startsWith("!"));
}

/**
 * The lockfile key of `name` installed at `spec`. A spec is a version, or `npm:<real>@<version>`
 * for an npm alias (`@openai/codex-linux-x64` installs `@openai/codex@0.154.0-linux-x64`).
 */
function lockKey(name, spec) {
  return spec.startsWith("npm:") ? spec.slice(4) : `${name}@${spec}`;
}

/**
 * `name` → spec (a version, or `npm:<real>@<version>` for an alias) of every package the
 * `natives` declared by the lockfile importers `importers` (`plugins/<dir>`) need, as
 * pnpm-lock.yaml resolves them: their snapshots' dependencies and optional dependencies,
 * transitively, minus the platform packages for none of the `targets` (`[{ os, cpu }]`). A
 * platform package of a package named in `hostOnly` is kept for `host` alone: one too large to
 * ship for every target. Throws when one name resolves to two specs — an override holds one.
 */
export function lockedClosure(lock, importers, natives, targets, hostOnly = new Set(), host) {
  const queue = [];
  for (const key of importers) {
    for (const [name, { version }] of Object.entries(lock.importers?.[key]?.dependencies ?? {})) {
      if (natives.has(name)) queue.push([name, version]);
    }
  }
  const here = host ?? { os: process.platform, cpu: process.arch };
  const closure = new Map();
  for (const [name, ref] of queue) {
    const bare = ref.replace(/\(.*$/, ""); // `0.1.0-rc.7(<peers>)` → `0.1.0-rc.7`
    // An alias's ref names the real package: `@openai/codex@0.154.0-linux-x64`.
    const alias = /.@/.test(bare);
    const spec = alias ? `npm:${bare}` : bare;
    const pkg = lock.packages?.[lockKey(name, spec)];
    if (pkg === undefined) throw new Error(`pnpm-lock.yaml has no package ${lockKey(name, spec)}`);
    const real = alias ? bare.slice(0, bare.lastIndexOf("@")) : name;
    const wanted = hostOnly.has(real) && (pkg.os || pkg.cpu) ? [here] : targets;
    if (!wanted.some((t) => admits(pkg.os, t.os) && admits(pkg.cpu, t.cpu))) continue;
    if (closure.has(name)) {
      if (closure.get(name) !== spec) {
        throw new Error(`${name}: pnpm-lock.yaml resolves ${closure.get(name)} and ${spec}`);
      }
      continue;
    }
    closure.set(name, spec);
    const snapshot = lock.snapshots?.[alias ? ref : `${name}@${ref}`] ?? {};
    for (const next of [snapshot.dependencies, snapshot.optionalDependencies]) {
      queue.push(...Object.entries(next ?? {}));
    }
  }
  return new Map([...closure].sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** The `resolution.integrity` pnpm-lock.yaml pins for `name` at `spec`, if any. */
function lockedIntegrity(lock, name, spec) {
  return lock.packages?.[lockKey(name, spec)]?.resolution?.integrity;
}

/** The lockfile entries the closure was read from, for build-plugins' cache key. */
export function lockCacheInput(lock, closure) {
  return [...closure]
    .map(([name, version]) => `${name}@${version} ${lockedIntegrity(lock, name, version)}`)
    .join("\0");
}

/**
 * The closure's per-platform packages (those with an `os` or `cpu`), as `name@version`: npm
 * installs only the building machine's, so build-plugins installs the rest with `--force`.
 */
export function platformSpecs(lock, closure) {
  return [...closure]
    .filter(([name, version]) => {
      const pkg = lock.packages[lockKey(name, version)];
      return pkg.os !== undefined || pkg.cpu !== undefined;
    })
    .map(([name, version]) => `${name}@${version}`);
}

/**
 * Every way npm's installed tree departs from pnpm-lock.yaml, as messages (empty when none).
 * `npmLock` is npm's hidden lockfile (`node_modules/.package-lock.json`): each installed package
 * keyed by its path, with the integrity of the tarball npm verified on download. Packages named
 * in `ignored` (the builtin plugins, installed from their own tarballs) are not checked.
 */
export function integrityMismatches(lock, closure, npmLock, ignored = new Set()) {
  const problems = [];
  const seen = new Set();
  for (const [key, entry] of Object.entries(npmLock.packages ?? {})) {
    if (key === "") continue; // the prefix's own manifest
    // The name it is installed under; an alias's entry names the real package beside it.
    const name = key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
    if (ignored.has(name)) continue;
    const spec =
      entry.name !== undefined && entry.name !== name
        ? `npm:${entry.name}@${entry.version}`
        : entry.version;
    const id = `${name}@${spec}`;
    seen.add(name);
    if (closure.get(name) !== spec) {
      problems.push(`${id}: not in the locked closure`);
      continue;
    }
    const want = lockedIntegrity(lock, name, spec);
    if (want === undefined) problems.push(`${id}: pnpm-lock.yaml records no integrity`);
    else if (entry.integrity !== want) {
      problems.push(`${id}: npm installed ${entry.integrity ?? "(no integrity)"}, locked ${want}`);
    }
  }
  for (const [name, version] of closure) {
    if (!seen.has(name)) problems.push(`${name}@${version}: not in npm's lockfile`);
  }
  return problems;
}
