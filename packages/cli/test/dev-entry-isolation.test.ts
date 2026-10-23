/**
 * Drift guard for the port/data-root isolation of the dev entry points.
 *
 * Two servers cannot share a port, and a data root admits one server at a time
 * (`<root>/server.lock`) — so entry points meant to run at the same time must differ in
 * BOTH. The pair that carries that requirement is `pnpm dev:server` and the dev CLI's
 * `wafh web`: a harness started as `pnpm wafh web` is exactly what asks an Agent to
 * run `pnpm dev` in this repo (the allocation table lives in
 * `packages/core/src/internal/ports.ts`). The assignments themselves are run-with-env
 * defaults on package.json script lines that nothing type-checks, so this test parses
 * them back out and pins the disjointness — including against the installed server's
 * port and root, which those dev entries must never touch.
 *
 * The desktop's dev shell deliberately shares `~/.waf-harness/dev-data` with `dev:server`
 * (a second server on a locked root is its attach-mode case, and the two surfaces
 * sharing one dataset when used alternately is the point), and it binds no fixed port —
 * so it is pinned to that root rather than away from it.
 *
 * Every dev entry point that starts a server also clears an inherited WAFH_CLI_ENTRY
 * (run-with-env's `--unset`): a terminal of an installed app hands its own CLI's path to what
 * starts there, and a dev server given it would offer that CLI as its own. A packaged or
 * installed launch keeps honouring the variable — it is how `wafh server|web` and the
 * desktop app name their CLI (server cli-shim.test.ts, desktop launcher.test.ts).
 *
 * The globally linked `wafh` (scripts/dev-cli-link, put on PATH by `pnpm link:cli`) is the
 * same dev CLI, built rather than from source:
 *
 * - Given an inherited environment, when the linked `wafh` starts the built CLI, then the CLI
 *   sees exactly what run-with-env gives `pnpm wafh`'s command, inherited values included.
 * - Given links of packages/cli itself on PATH, when `pnpm link:cli` runs, then the ones that
 *   lead into this checkout's packages/cli/dist are removed and any other `wafh` is left alone.
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_SERVER_PORT } from "@waterford/waf-harness-core";

const cliDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(cliDir, "..", "..");

const readScripts = (pkgPath: string): Record<string, string> =>
  (JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> }).scripts ?? {};

/** The tokens a script passes to run-with-env.mjs before `--`, or null when it does not use it. */
function runWithEnvTokens(script: string | undefined): string[] | null {
  if (script === undefined) return null;
  const m = script.match(/run-with-env\.mjs\s+(.+?)\s+--\s/);
  return m === null ? null : m[1]!.split(/\s+/);
}

/**
 * The `VAR=value` defaults a script passes to run-with-env.mjs (the segment between the
 * script path and the `--` separator). Returns null when the script does not use it.
 */
function runWithEnvDefaults(script: string | undefined): Record<string, string> | null {
  const tokens = runWithEnvTokens(script);
  if (tokens === null) return null;
  const defaults: Record<string, string> = {};
  for (const token of tokens) {
    const eq = token.indexOf("=");
    if (eq > 0 && !token.startsWith("--")) defaults[token.slice(0, eq)] = token.slice(eq + 1);
  }
  return defaults;
}

/** The variables a script has run-with-env.mjs clear (`--unset=VAR`). */
function runWithEnvUnsets(script: string | undefined): string[] {
  return (runWithEnvTokens(script) ?? [])
    .filter((token) => token.startsWith("--unset="))
    .map((token) => token.slice("--unset=".length));
}

/** Expands the leading `~/` the same way run-with-env.mjs does, then normalizes. */
function expandHome(value: string): string {
  const expanded =
    value === "~" || value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
  return path.normalize(expanded);
}

const rootScripts = readScripts(path.join(repoRoot, "package.json"));
const serverScripts = readScripts(path.join(repoRoot, "packages", "server", "package.json"));
const cliScripts = readScripts(path.join(cliDir, "package.json"));

const devServer = runWithEnvDefaults(serverScripts["dev"]);
const devCli = runWithEnvDefaults(rootScripts["wafh"]);
const devDesktop = runWithEnvDefaults(rootScripts["desktop"]);

/** The installed server/CLI root, `~/.waf-harness/data` (core's resolveRoot() default). */
const installedRoot = path.join(os.homedir(), ".waf-harness", "data");

describe("dev entry point isolation (ports and data roots)", () => {
  it("dev:server and the dev CLI each declare a port and a data root", () => {
    for (const [name, defaults] of [
      ["dev:server", devServer],
      ["wafh", devCli],
    ] as const) {
      expect(defaults, `${name} must set its defaults through run-with-env`).not.toBeNull();
      expect(defaults!.PORT, `${name} must pin a port`).toMatch(/^\d+$/);
      expect(defaults!.WAFH_HOME, `${name} must pin a data root`).toBeDefined();
    }
  });

  it("no two simultaneously runnable server entries share a port", () => {
    const ports = [
      Number(devServer!.PORT),
      Number(devCli!.PORT),
      DEFAULT_SERVER_PORT, // the installed server both dev entries must coexist with
    ];
    expect(new Set(ports).size).toBe(ports.length);
  });

  it("no two simultaneously runnable server entries share a data root", () => {
    const roots = [
      expandHome(devServer!.WAFH_HOME!),
      expandHome(devCli!.WAFH_HOME!),
      path.normalize(installedRoot),
    ];
    expect(new Set(roots).size).toBe(roots.length);
  });

  it("the root and packages/cli wafh scripts agree on their defaults", () => {
    // Two spellings of the same entry point; a root moved in one and not the other
    // would make `pnpm wafh` and `pnpm --dir packages/cli wafh` serve different data.
    expect(runWithEnvDefaults(cliScripts["wafh"])).toEqual(devCli);
  });

  it("the dev desktop shell stays on dev:server's root, by design", () => {
    expect(devDesktop).not.toBeNull();
    expect(expandHome(devDesktop!.WAFH_HOME!)).toBe(expandHome(devServer!.WAFH_HOME!));
    // No PORT: the embedded server allocates its own (PORT=0 + sticky preference).
    expect(devDesktop!.PORT).toBeUndefined();
  });
});

describe("dev entry points and an inherited WAFH_CLI_ENTRY", () => {
  it("every dev entry point that starts a server clears it; the packaged launches do not", () => {
    for (const [name, script] of [
      ["dev:server", serverScripts["dev"]],
      ["desktop", rootScripts["desktop"]],
      ["wafh", rootScripts["wafh"]],
      ["packages/cli wafh", cliScripts["wafh"]],
    ] as const) {
      expect(runWithEnvUnsets(script), name).toContain("WAFH_CLI_ENTRY");
    }
    // `node dist/index.js` and the desktop app's own `electron .` are how an installation runs
    // them: whoever launches those names the CLI on purpose.
    const desktopScripts = readScripts(path.join(repoRoot, "packages", "desktop", "package.json"));
    for (const script of [serverScripts["start"], desktopScripts["start"]]) {
      expect(script).not.toContain("WAFH_CLI_ENTRY");
    }
  });

  it("run-with-env passes the command no value for it, and says what it cleared", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "wafh-run-with-env-"));
    try {
      const report = path.join(tmp, "report.mjs");
      writeFileSync(
        report,
        "process.stdout.write(JSON.stringify({ entry: process.env.WAFH_CLI_ENTRY ?? null, " +
          "home: process.env.WAFH_HOME ?? null }));\n",
      );
      // A WAFH_HOME of this process's own would win over the default the script is given.
      const { WAFH_HOME: _inherited, ...base } = process.env;
      const run = (unset: string[]) =>
        spawnSync(
          process.execPath,
          [
            path.join(repoRoot, "scripts", "run-with-env.mjs"),
            ...unset,
            `WAFH_HOME=${tmp}`,
            "--",
            process.execPath,
            report,
          ],
          {
            encoding: "utf8",
            env: { ...base, WAFH_CLI_ENTRY: "/opt/installed/wafh.js" },
          },
        );

      const cleared = run(["--unset=WAFH_CLI_ENTRY"]);
      expect(cleared.status, cleared.stderr).toBe(0);
      expect(JSON.parse(cleared.stdout)).toEqual({ entry: null, home: tmp });
      expect(cleared.stderr).toContain("WAFH_CLI_ENTRY=/opt/installed/wafh.js");

      // Without the flag the inherited value is the command's, as any other variable is.
      const kept = run([]);
      expect(JSON.parse(kept.stdout)).toEqual({ entry: "/opt/installed/wafh.js", home: tmp });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("the globally linked wafh", () => {
  /** process.env without the variables the dev CLI's assignments decide. */
  const {
    WAFH_HOME: _home,
    WAFH_PROFILE: _profile,
    PORT: _port,
    WAFH_CLI_ENTRY: _entry,
    ...base
  } = process.env;

  /** A throwaway checkout: scripts/dev-cli-link beside a built CLI that prints its environment. */
  function withCheckout(test: (dir: string, entry: string) => void): void {
    const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wafh-dev-cli-link-")));
    try {
      const link = path.join("scripts", "dev-cli-link");
      cpSync(path.join(repoRoot, link), path.join(dir, link), { recursive: true });
      const entry = path.join(dir, "packages", "cli", "dist", "wafh.js");
      mkdirSync(path.dirname(entry), { recursive: true });
      writeFileSync(
        entry,
        "const names = ['WAFH_HOME', 'WAFH_PROFILE', 'PORT', 'WAFH_CLI_ENTRY'];\n" +
          "process.stdout.write(JSON.stringify(names.map((n) => process.env[n] ?? null)));\n",
      );
      test(dir, entry);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("gives the built CLI the environment pnpm wafh gives it", () => {
    withCheckout((dir, entry) => {
      const tokens = runWithEnvTokens(rootScripts["wafh"])!;
      for (const inherited of [
        { WAFH_HOME: "", WAFH_CLI_ENTRY: "/opt/installed/wafh.js" },
        { WAFH_HOME: path.join(dir, "elsewhere"), WAFH_PROFILE: "release", PORT: "1234" },
      ]) {
        const env = { ...base, ...inherited };
        const linked = spawnSync(
          process.execPath,
          [path.join(dir, "scripts", "dev-cli-link", "wafh.mjs")],
          { encoding: "utf8", env },
        );
        const script = path.join(repoRoot, "scripts", "run-with-env.mjs");
        const fromSource = spawnSync(
          process.execPath,
          [script, ...tokens, "--", process.execPath, entry],
          { encoding: "utf8", env },
        );
        expect(JSON.parse(linked.stdout), linked.stderr).toEqual(JSON.parse(fromSource.stdout));
      }
    });
  });

  it("pnpm link:cli removes only the earlier links into this checkout's packages/cli/dist", () => {
    withCheckout((dir, entry) => {
      /** A pnpm 10 global shim (the sh flavour) that runs `target` relative to its directory. */
      const shim = (file: string, target: string) => {
        mkdirSync(path.dirname(file), { recursive: true });
        const rel = path.relative(path.dirname(file), target).split(path.sep).join("/");
        writeFileSync(file, `#!/bin/sh\nexec node  "$basedir/${rel}" "$@"\n`);
      };
      const pnpmHome = path.join(dir, "pnpm-home");
      const elsewhere = path.join(dir, "elsewhere-bin");
      shim(path.join(pnpmHome, "wafh"), entry);
      shim(path.join(elsewhere, "wafh"), path.join(dir, "other", "packages/cli/dist/wafh.js"));
      // Creating symlinks needs a privilege Windows runners do not grant by default.
      const symlinks = process.platform !== "win32";
      if (symlinks) symlinkSync(entry, path.join(elsewhere, "wafh-hmr"));
      // A stand-in for the pnpm that runs the script, which would otherwise link for real.
      const pnpm = path.join(dir, "pnpm.mjs");
      writeFileSync(pnpm, "");
      // Windows spells it Path: drop it, so the stand-in PATH is the only one.
      const env = Object.fromEntries(
        Object.entries(base).filter(([key]) => key.toUpperCase() !== "PATH"),
      );

      const run = spawnSync(
        process.execPath,
        [path.join(dir, "scripts", "dev-cli-link", "link.mjs")],
        {
          encoding: "utf8",
          env: { ...env, npm_execpath: pnpm, PATH: [pnpmHome, elsewhere].join(path.delimiter) },
        },
      );

      expect(run.status, run.stderr).toBe(0);
      expect(existsSync(path.join(pnpmHome, "wafh"))).toBe(false);
      expect(existsSync(path.join(elsewhere, "wafh"))).toBe(true);
      if (symlinks) expect(existsSync(path.join(elsewhere, "wafh-hmr"))).toBe(false);
    });
  });
});
