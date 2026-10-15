/**
 * Building a run's module runs code its agent wrote (the package.json build script, the
 * webpack config), so the module builder builds it as the agent's own commands ran: with none
 * of this server's environment and, while activity agents are confined, through the session
 * sandbox, writable only in the module. Real programs throughout: the module's `npm run build`
 * and a stand-in for the pinned Sass's command line, each a probe that says what it saw and
 * where it could write. A stand-in sandbox runner shows what reaches the confiner; the real
 * sandbox, where this host has one, shows what the confinement stops.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { SpawnConfiner } from "@prismshadow/penguin-core";
import type { SandboxProvider } from "@prismshadow/penguin-core/plugin";
import { moduleBuilds, PinnedSass, sassHome } from "../src/activities/module-builder.js";
import { SandboxService } from "../src/sandbox/service.js";

/** A variable of this server's that a build must not see, named as the harness's own are. */
const SECRET = "PENGUIN_PREVIEW_BUILD_PROBE";
/** One that is not the harness's: a build sees only what it needs, not all but PENGUIN_*. */
const TOKEN = "PREVIEW_BUILD_PROBE_TOKEN";

/**
 * A probe for one program of the build: it prints the variables it was given and whether it
 * runs inside the stand-in sandbox, tries each write it is told to, then marks itself done.
 */
function probe(who: string, writes: Record<string, string> = {}): string {
  return `
const fs = require("fs");
console.log(${JSON.stringify(who)} + " secret=" + (process.env.${SECRET} ?? "none") + " token=" + (process.env.${TOKEN} ?? "none"));
console.log(${JSON.stringify(who)} + " sandboxed=" + (process.env.STAND_IN_SANDBOX ?? "no"));
for (const [where, file] of Object.entries(${JSON.stringify(writes)})) {
  try { fs.writeFileSync(file, "${who}"); console.log(${JSON.stringify(who)} + " " + where + "=written"); }
  catch (error) { console.log(${JSON.stringify(who)} + " " + where + "=refused"); }
}
fs.writeFileSync(${JSON.stringify(`${who}.done`)}, "");
`;
}

/** The Sass command line's stand-in: `sass.js <from> <to> --no-source-map` copies, then probes. */
function sassCli(writes: Record<string, string> = {}): string {
  return `
const [from, to] = process.argv.slice(2);
require("fs").writeFileSync(to, "/* compiled */ " + require("fs").readFileSync(from, "utf8"));
${probe("sass", writes)}`;
}

/**
 * A stand-in sandbox runner: it starts the argv it wraps, marking its environment, as a real
 * runner starts what it confines. Through it, a program that says it was sandboxed was started
 * from what the confiner returned.
 */
const STAND_IN_RUNNER = `
const { spawnSync } = require("child_process");
const [program, ...args] = process.argv.slice(2);
const result = spawnSync(program, args, { stdio: "inherit", env: { ...process.env, STAND_IN_SANDBOX: "yes" } });
process.exit(result.status ?? 1);
`;

const roots: string[] = [];
afterEach(async () => {
  delete process.env[SECRET];
  delete process.env[TOKEN];
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

/**
 * A run's module (a stylesheet and an `npm run build` that probes) beside Penguin's root, with
 * the pinned Sass already installed there as its stand-in, and the packages every run shares
 * linked in as the module's node_modules. Made under `parent`.
 */
async function runModule(
  options: {
    parent?: string;
    stylesheet?: boolean;
    writes?: (layout: { shared: string }) => Record<string, string>;
  } = {},
) {
  const root = await fs.mkdtemp(path.join(options.parent ?? os.tmpdir(), "penguin-run-build-"));
  roots.push(root);
  const module = path.join(root, "activity-runs", "run_1", "module");
  const shared = path.join(root, "module-packages-cache", "set", "node_modules");
  const writes = options.writes?.({ shared }) ?? {};
  await fs.mkdir(path.join(module, "res"), { recursive: true });
  await fs.mkdir(shared, { recursive: true });
  await fs.symlink(shared, path.join(module, "node_modules"), "junction");
  await fs.writeFile(
    path.join(module, "package.json"),
    JSON.stringify({ name: "m", version: "1.0.0", scripts: { build: "node build.js" } }),
  );
  await fs.writeFile(path.join(module, "build.js"), probe("build", writes));
  if (options.stylesheet ?? true)
    await fs.writeFile(path.join(module, "res", "style.scss"), ".a { color: red; }");
  const sass = path.join(sassHome(root), "node_modules", "sass");
  await fs.mkdir(sass, { recursive: true });
  await fs.writeFile(path.join(sass, "package.json"), JSON.stringify({ version: "1.54.0" }));
  await fs.writeFile(path.join(sass, "sass.js"), sassCli(writes));
  const runner = path.join(root, "stand-in-runner.cjs");
  await fs.writeFile(runner, STAND_IN_RUNNER);
  const pinned = new PinnedSass(sassHome(root));
  /** The builder over the pinned Sass, its run builds confined by `confiner` (null: not). */
  const builder = (confiner: SpawnConfiner | null) =>
    moduleBuilds(
      (job) => pinned.compile(job),
      () => confiner,
    );
  return { root, module, shared, runner, builder };
}

/** A confiner over the stand-in runner that records what it was asked to confine. */
function standInConfiner(runner: string) {
  const calls: { argv: readonly string[]; opts: Parameters<SpawnConfiner>[1] }[] = [];
  const confiner: SpawnConfiner = (argv, opts) => {
    calls.push({ argv, opts });
    return [process.execPath, runner, ...argv];
  };
  return { confiner, calls };
}

describe("a run module's build", () => {
  it("runs each of its programs through the session sandbox, writable in the module", async () => {
    const { module, runner, builder } = await runModule();
    const sandbox = standInConfiner(runner);
    const outcome = await builder(sandbox.confiner).buildRun(module);
    expect(outcome.ok, outcome.log).toBe(true);
    // The stylesheet's compile, then the build script, each confined to the module alone.
    expect(sandbox.calls.map((call) => call.opts)).toEqual([
      { cwd: module, workspaceDir: module, sessionMode: "workspace-write" },
      { cwd: module, workspaceDir: module, sessionMode: "workspace-write" },
    ]);
    expect(sandbox.calls[0]!.argv).toContain("res/style.scss");
    expect(sandbox.calls[1]!.argv.join(" ")).toContain("npm run build");
    // Each ran as the confiner returned it.
    expect(outcome.log).toContain("sass sandboxed=yes");
    expect(outcome.log).toContain("build sandboxed=yes");
    expect(await fs.readFile(path.join(module, "res", "style.css"), "utf8")).toContain(".a");
  });

  it("starts them with none of this server's environment, and npm's cache in the module", async () => {
    process.env[SECRET] = "leaked";
    process.env[TOKEN] = "leaked";
    const { module, runner, builder } = await runModule();
    const outcome = await builder(standInConfiner(runner).confiner).buildRun(module);
    expect(outcome.ok, outcome.log).toBe(true);
    expect(outcome.log).toContain("sass secret=none token=none");
    expect(outcome.log).toContain("build secret=none token=none");
    expect(outcome.log).not.toContain("leaked");
    // The user's own npm cache is outside what a confined build may write.
    expect(existsSync(path.join(module, ".npm-cache"))).toBe(true);
  });

  it("builds unconfined while activity agents are not, still without the server's environment", async () => {
    process.env[SECRET] = "leaked";
    const { module, builder } = await runModule();
    const outcome = await builder(null).buildRun(module);
    expect(outcome.ok, outcome.log).toBe(true);
    expect(outcome.log).toContain("build sandboxed=no");
    expect(outcome.log).toContain("build secret=none");
    expect(existsSync(path.join(module, ".npm-cache"))).toBe(false);
  });

  it("runs nothing of a build the sandbox will not confine, and says why", async () => {
    const refusing: SpawnConfiner = () => {
      throw new Error('sandbox mode "workspace-write" is configured but no backend is mounted');
    };
    const styled = await runModule();
    const style = await styled.builder(refusing).buildRun(styled.module);
    expect(style.ok).toBe(false);
    expect(style.log).toContain("no backend is mounted");
    expect(style.log).toContain("res/style.scss did not compile.");
    expect(existsSync(path.join(styled.module, "res", "style.css"))).toBe(false);
    expect(existsSync(path.join(styled.module, "build.done"))).toBe(false);

    const plain = await runModule({ stylesheet: false });
    const build = await plain.builder(refusing).buildRun(plain.module);
    expect(build.ok).toBe(false);
    expect(build.log).toContain("The build could not be started: sandbox mode");
    expect(existsSync(path.join(plain.module, "build.done"))).toBe(false);
  });
});

/**
 * The sandbox-dsh plugin's backend, as the server loads it; null where it is not built or this
 * host has nothing it can confine with.
 */
async function hostSandbox(): Promise<SandboxService | null> {
  const entry = path.resolve(import.meta.dirname, "../../../plugins/sandbox-dsh/dist/index.js");
  const plugin = (await import(pathToFileURL(entry).href).catch(() => null)) as {
    loadDshAdaptor(): Promise<SandboxProvider | null>;
  } | null;
  const provider = await plugin?.loadDshAdaptor().catch(() => null);
  if (!provider) return null;
  const probeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-run-build-probe-"));
  try {
    provider.confine(["node"], { mode: "workspace-write", workspaceRoot: probeRoot });
  } catch {
    return null;
  } finally {
    await fs.rm(probeRoot, { recursive: true, force: true });
  }
  const sandbox = new SandboxService([["dsh-local", provider]]);
  await sandbox.whenReady();
  return sandbox;
}

const sandbox = await hostSandbox();

describe.skipIf(sandbox === null)("a run module's build in this host's sandbox", () => {
  it("writes its module and nothing outside it, the shared packages included", async () => {
    // Outside the temporary folder, which a sandbox may leave writable.
    const outside = path.join(os.homedir(), `penguin-run-build-${process.pid}.txt`);
    roots.push(outside);
    const { module, shared, builder } = await runModule({
      parent: os.homedir(),
      writes: ({ shared }) => ({ outside, shared: path.join(shared, "probe.txt") }),
    });
    const outcome = await builder(sandbox!.confiner()).buildRun(module);
    expect(outcome.ok, outcome.log).toBe(true);
    for (const who of ["sass", "build"]) {
      expect(outcome.log).toContain(`${who} outside=refused`);
      expect(outcome.log).toContain(`${who} shared=refused`);
      expect(existsSync(path.join(module, `${who}.done`))).toBe(true);
    }
    expect(existsSync(outside)).toBe(false);
    expect(await fs.readdir(shared)).toEqual([]);
    expect(await fs.readFile(path.join(module, "res", "style.css"), "utf8")).toContain(".a");
  }, 120_000);
});
