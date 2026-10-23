/**
 * The module release's four stages, each run on its own against fakes: the clone, npm, the
 * stylesheet compiler, Jenkins and the clock answer from memory, and the module clone is a
 * temp directory. No test here runs git, npm or a request, and nothing is written outside
 * the temp directory. What git does with a clone is `activity-clone.test.ts`'s.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SpawnConfiner } from "@waterford/waf-harness-core";
import { CloneError, CloneStopped, type CloneOptions } from "../src/activities/clone.js";
import type { DeployGitResult } from "../src/activities/deploy-git.js";
import type { DeployJenkins, JenkinsBuildStatus } from "../src/activities/deploy-jenkins.js";
import { JenkinsError } from "../src/activities/deploy-jenkins.js";
import type {
  DeployProcessOptions,
  DeployProcessResult,
} from "../src/activities/deploy-process.js";
import type { StyleJob } from "../src/activities/module-builder.js";
import { defaultDeploySettings } from "../src/activities/deploy-settings.js";
import { sandboxUnavailable } from "../src/activities/run-sandbox.js";
import {
  DEPLOY_STAGE_DEFINITIONS,
  DeployStageFailure,
  DeployStopped,
  RECHECK_MS,
  isModuleVersion,
  latestSemver,
  moduleBuildLine,
  modulePackageName,
  stageBlocker,
  startProblems,
  type DeployStageContext,
} from "../src/activities/deploy-stages.js";
import type { DeployContext, DeployStage } from "../src/activities/deploy-types.js";
import { FakeClones, type FakeRepo } from "./fake-clones.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

async function tempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** The commit every branch of a fake clone is at, unless a test names another. */
const HEAD = "0123abcd";

/** The module's package.json as its commit holds it. */
const MODULE_PKG = JSON.stringify({ name: "waf-module-words", version: "1.0.0" }, null, 2);

/**
 * Clones that answer from memory, the module clone at `dir` described by `repo`; its commit
 * holds `MODULE_PKG` unless `repo` names its files.
 */
function fakeClones(dir: string, repo: Partial<FakeRepo> = {}) {
  const clones = new FakeClones();
  clones.add(dir, {
    origin: "git@github.com:org/waf-module-words.git",
    files: { [HEAD]: { "package.json": MODULE_PKG } },
    ...repo,
  });
  return clones;
}

/** A fake module clone whose commit holds `files` besides `MODULE_PKG`. */
function committed(dir: string, files: Record<string, string>, repo: Partial<FakeRepo> = {}) {
  return fakeClones(dir, { files: { [HEAD]: { "package.json": MODULE_PKG, ...files } }, ...repo });
}

/** What was asked of the clones, by operation, with its arguments. */
function asked(clones: FakeClones, op: string): unknown[][] {
  return clones.calls.filter((call) => call.op === op).map((call) => call.args);
}

function fakeProcess(
  answer: (line: string) => Partial<DeployProcessResult> & { output?: string } = () => ({}),
) {
  const calls: (DeployProcessOptions & { line: string; userconfig?: string | null })[] = [];
  return {
    calls,
    process: {
      async run(
        command: string,
        args: string[],
        options: DeployProcessOptions,
      ): Promise<DeployProcessResult> {
        const line = `${command} ${args.join(" ")}`;
        const userconfig = options.env?.npm_config_userconfig;
        calls.push({
          ...options,
          line,
          // What npm would read as its user config, as it starts.
          ...(userconfig
            ? { userconfig: await fs.readFile(userconfig, "utf8").catch(() => null) }
            : {}),
        });
        const reply = answer(line);
        const output = reply.output ?? `${line} ok\n`;
        options.onOutput?.(output);
        return {
          code: reply.code ?? 0,
          tail: output,
          ...(reply.error ? { error: reply.error } : {}),
        };
      },
    },
  };
}

function fakeJenkins(statuses: Array<JenkinsBuildStatus | Error> = [{ state: "unknown" }]) {
  const triggers: Array<{ job: string; params: Record<string, string> }> = [];
  const polls: Array<{ after: number | null | undefined }> = [];
  const jenkins: DeployJenkins = {
    async trigger(job, params) {
      triggers.push({ job, params });
      return { queueUrl: "https://jenkins.example.org/queue/item/7/" };
    },
    async status(_job, _params, options) {
      polls.push({ after: options?.after });
      const next = statuses.length > 1 ? statuses.shift()! : statuses[0]!;
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { triggers, polls, jenkins };
}

function fakeClock() {
  let now = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    clock: {
      now: () => now,
      async sleep(ms: number) {
        sleeps.push(ms);
        now += ms;
      },
    },
  };
}

/**
 * A stylesheet compiler that writes `compiled(<source>)` where it was asked to, unless its
 * answer is a failure, and `also` beside it.
 */
function fakeStyles(answer: Partial<DeployProcessResult> = {}, also: Record<string, string> = {}) {
  const jobs: StyleJob[] = [];
  return {
    jobs,
    styles: async (job: StyleJob): Promise<DeployProcessResult> => {
      jobs.push(job);
      job.onOutput?.("compiled\n");
      const result = { code: 0, tail: "compiled\n", ...answer };
      if (result.code === 0) {
        const source = await fs.readFile(path.join(job.cwd, job.from), "utf8");
        await fs.writeFile(path.join(job.cwd, job.to), `compiled(${source})`);
        for (const [file, content] of Object.entries(also))
          await fs.writeFile(path.join(job.cwd, file), content);
      }
      return result;
    },
  };
}

async function moduleClone() {
  const dir = await tempDir("wafh-deploy-module-");
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "waf-module-words", version: "1.0.0" }, null, 2),
  );
  return dir;
}

function settings() {
  const value = defaultDeploySettings();
  value.git = { userName: "Deploy Bot", userEmail: "deploy@example.org" };
  value.timeouts.buildMinutes = 1;
  return value;
}

function context(
  overrides: Partial<DeployStageContext> & { dir: string; source?: string | null },
): { ctx: DeployStageContext; lines: string[]; controller: AbortController } {
  const lines: string[] = [];
  const controller = new AbortController();
  const { dir, source, ...rest } = overrides;
  const clones = rest.clones ?? fakeClones(dir);
  const checks = `${dir}-checks`;
  dirs.push(checks);
  return {
    lines,
    controller,
    ctx: {
      clones,
      serial: clones instanceof FakeClones ? clones.serial : (_repo, work) => work(),
      jenkins: fakeJenkins().jenkins,
      process: fakeProcess().process,
      styles: fakeStyles().styles,
      confinement: () => null,
      clock: fakeClock().clock,
      settings: settings(),
      productCode: "words",
      module: {
        folder: "waf-module-words",
        dir,
        checkDir: path.join(checks, "waf-module-words"),
        source: source ?? null,
      },
      moduleVersion: null,
      metadata: {},
      earlier: {},
      log: (text) => lines.push(text),
      signal: controller.signal,
      ...rest,
    },
  };
}

const run = (stage: DeployStage, ctx: DeployStageContext) =>
  DEPLOY_STAGE_DEFINITIONS[stage].run(ctx);

/** The check folders left under the module's `checkDir`: none once a stage has ended. */
const checkFolders = (ctx: DeployStageContext) => fs.readdir(ctx.module.checkDir).catch(() => []);

/** A check folder of the module's own, as a stage makes one for each run of the checks. */
const aCheckFolder = (ctx: DeployStageContext) =>
  expect.stringContaining(path.join(ctx.module.checkDir, "check-"));

describe("deploy names and versions", () => {
  it("names the package, the build line and the newest plain release tag", () => {
    expect(modulePackageName("waf-module-Words")).toBe("wafmodule-words");
    expect(moduleBuildLine("waf-module-words")).toBe("words loom/words-deploy");
    expect(latestSemver(["v1.2.0", "1.10.0", "1.11.0-beta.1", "release", "1.9.9"])).toBe("1.10.0");
    expect(latestSemver(["main"])).toBeNull();
    expect(isModuleVersion("2.0.1")).toBe(true);
    for (const bad of ["v2.0.1", "2.0", "02.0.1", "2.0.1-rc.1"])
      expect(isModuleVersion(bad)).toBe(false);
  });
});

describe("verify_module", () => {
  it("copies the assembled module over the clone and runs the four npm checks in order", async () => {
    const dir = await moduleClone();
    const source = await tempDir("wafh-deploy-source-");
    await fs.mkdir(path.join(source, "src"), { recursive: true });
    await fs.writeFile(path.join(source, "src", "index.js"), "export {};");
    await fs.writeFile(path.join(source, "package.json"), '{"name":"built"}');
    await fs.mkdir(path.join(source, "node_modules", "left"), { recursive: true });
    await fs.writeFile(path.join(source, "node_modules", "left", "x.js"), "");
    // It would send the push's LFS upload elsewhere.
    await fs.writeFile(path.join(source, ".lfsconfig"), '[lfs]\n\turl = "https://elsewhere"\n');
    const clones = fakeClones(dir);
    const npm = fakeProcess();
    const { ctx, lines } = context({ dir, source, clones, process: npm.process });
    await run("verify_module", ctx);
    expect(await fs.readFile(path.join(dir, "src", "index.js"), "utf8")).toBe("export {};");
    expect(await fs.readFile(path.join(dir, "package.json"), "utf8")).toBe('{"name":"built"}');
    await expect(fs.stat(path.join(dir, "node_modules"))).rejects.toThrow();
    await expect(fs.stat(path.join(dir, ".lfsconfig"))).rejects.toThrow();
    expect(npm.calls.map((call) => call.line)).toEqual([
      "npm ci",
      "npm run buildDebug",
      "npm run lint",
      "npm run buildRelease",
    ]);
    // The checks run on the commit just made, in the check folder, which is gone after.
    const folder = npm.calls[0]!.cwd!;
    expect(path.dirname(folder)).toBe(ctx.module.checkDir);
    expect(npm.calls.every((call) => call.cwd === folder)).toBe(true);
    expect(await checkFolders(ctx)).toEqual([]);
    // Main is brought up to origin carrying the work, never reset, and the copied module is
    // committed on it.
    expect(clones.ops(dir)).toEqual([
      "fetch",
      "onBranchFromOrigin",
      "stage",
      "commitStaged",
      "exportTo",
    ]);
    expect(asked(clones, "exportTo")).toEqual([[HEAD, folder]]);
    expect(asked(clones, "onBranchFromOrigin")).toEqual([["main", { work: "carry" }]]);
    expect(asked(clones, "stage")).toEqual([["all", {}]]);
    expect(asked(clones, "commitStaged")).toEqual([
      ["WAF Harness: words as authored", { name: "Deploy Bot", email: "deploy@example.org" }],
    ]);
    expect(lines).toContain("Committed the authored module on main: 0123abcd.");
    expect(lines).toContain("$ npm run lint");
  });

  it("names the module build it verified, and none for a clone verified as it is", async () => {
    const source = await tempDir("wafh-deploy-source-");
    await fs.writeFile(path.join(source, "package.json"), '{"name":"built"}');
    const built = context({ dir: await moduleClone(), source });
    built.ctx.module.runId = "run_built";
    await run("verify_module", built.ctx);
    expect(built.ctx.metadata.moduleRunId).toBe("run_built");
    const asIs = context({ dir: await moduleClone() });
    await run("verify_module", asIs.ctx);
    expect(asIs.ctx.metadata).not.toHaveProperty("moduleRunId");
  });

  it("says so when main already had everything authored", async () => {
    const dir = await moduleClone();
    const clones = fakeClones(dir, { nothingStaged: true, head: "4567cdef" });
    const { ctx, lines } = context({ dir, clones });
    await run("verify_module", ctx);
    expect(lines).toContain("Main already had everything authored.");
    // What is checked is main's commit.
    expect(asked(clones, "commitOf")).toEqual([["main"]]);
    expect(asked(clones, "exportTo")).toEqual([["4567cdef", aCheckFolder(ctx)]]);
  });

  it("commits a new module's first work, which stays in place on main", async () => {
    const dir = await moduleClone();
    await fs.writeFile(path.join(dir, "authored.js"), "export const kept = true;");
    const clones = fakeClones(dir, { dirty: true, unborn: true, branches: [] });
    const { ctx, lines } = context({ dir, clones });
    await run("verify_module", ctx);
    expect(lines).toContain("No commit yet: the new module's work stays in place.");
    expect(clones.ops(dir).slice(-3)).toEqual(["stage", "commitStaged", "exportTo"]);
    expect(await fs.readFile(path.join(dir, "authored.js"), "utf8")).toBe(
      "export const kept = true;",
    );
  });

  it("stops, with git's words, when main cannot be brought up to origin carrying the work", async () => {
    const dir = await moduleClone();
    const clones = fakeClones(dir, { dirty: true, fail: { onBranchFromOrigin: "needs merge" } });
    const { ctx } = context({ dir, clones });
    const failure = await run("verify_module", ctx).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(DeployStageFailure);
    expect((failure as DeployStageFailure).error).toMatchObject({
      code: "command_failed",
      output: "needs merge",
    });
    expect(clones.ops(dir)).not.toContain("stage");
  });

  it("names the repository to create when a new module's has not been made", async () => {
    const dir = await moduleClone();
    const clones = fakeClones(dir, { fail: { fetch: "ERROR: Repository not found." } });
    const { ctx } = context({ dir, clones });
    const failure = await run("verify_module", ctx).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(DeployStageFailure);
    expect((failure as DeployStageFailure).error).toEqual({
      code: "module_repository_missing",
      remote: "git@github.com:org/waf-module-words.git",
    });
    expect(clones.ops(dir)).not.toContain("stage");
  });

  it("fails on a failing lint with the end of its output, and runs nothing after it", async () => {
    const dir = await moduleClone();
    const npm = fakeProcess((line) =>
      line === "npm run lint" ? { code: 1, output: "src/a.js\n  3:1  error  no-undef\n" } : {},
    );
    const { ctx, lines } = context({ dir, process: npm.process });
    const failure = await run("verify_module", ctx).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(DeployStageFailure);
    expect((failure as DeployStageFailure).error).toEqual({
      code: "command_failed",
      command: "npm run lint",
      exitCode: 1,
      output: "src/a.js\n  3:1  error  no-undef",
    });
    expect(npm.calls.map((call) => call.line)).not.toContain("npm run buildRelease");
    expect(lines).toContain("  3:1  error  no-undef");
  });

  it("says npm is missing rather than failing on an exit code", async () => {
    const dir = await moduleClone();
    const npm = fakeProcess(() => ({ code: null, error: "not_found" }));
    const { ctx } = context({ dir, process: npm.process });
    await expect(run("verify_module", ctx)).rejects.toMatchObject({
      error: { code: "command_missing", command: "npm" },
    });
  });
});

describe("prepare_deploy", () => {
  it("makes the deploy branch from main, writes the package, compiles the stylesheet and commits", async () => {
    const dir = await moduleClone();
    const lock = JSON.stringify({
      name: "old",
      version: "1.0.0",
      packages: { "": { name: "old", version: "1.0.0" } },
    });
    const clones = committed(
      dir,
      { "package-lock.json": lock, "res/style.scss": "a { b: c }" },
      { changed: ["package.json", "package-lock.json", "res/style.css"] },
    );
    const npx = fakeProcess();
    const sass = fakeStyles();
    const { ctx, lines } = context({
      dir,
      clones,
      process: npx.process,
      styles: sass.styles,
      moduleVersion: "2.3.4",
    });
    await run("prepare_deploy", ctx);
    expect(asked(clones, "branchFrom")).toEqual([["loom/words-deploy", HEAD]]);
    const pkg = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8"));
    expect(pkg).toEqual({ name: "wafmodule-words", version: "2.3.4" });
    const written = JSON.parse(await fs.readFile(path.join(dir, "package-lock.json"), "utf8"));
    expect(written).toEqual({
      name: "wafmodule-words",
      version: "2.3.4",
      packages: { "": { name: "wafmodule-words", version: "2.3.4" } },
    });
    // The stylesheet is compiled by the pinned Sass the preview uses, in the check folder, and
    // what that made is the clone's.
    expect(npx.calls).toEqual([]);
    expect(sass.jobs).toEqual([
      expect.objectContaining({
        cwd: aCheckFolder(ctx),
        from: "res/style.scss",
        to: "res/style.css",
      }),
    ]);
    expect(await fs.readFile(path.join(dir, "res", "style.css"), "utf8")).toBe(
      "compiled(a { b: c })",
    );
    expect(await checkFolders(ctx)).toEqual([]);
    expect(lines).toContain("$ sass@1.54.0 res/style.scss res/style.css --no-source-map");
    expect(lines).toContain("compiled");
    expect(asked(clones, "stage")).toEqual([
      [["package.json", "package-lock.json", "res/style.css"], {}],
    ]);
    expect(asked(clones, "commitStaged")).toEqual([
      ["Prepare module deploy for words", { name: "Deploy Bot", email: "deploy@example.org" }],
    ]);
    expect(ctx.metadata).toEqual({ moduleVersion: "2.3.4", commit: "0123abcd" });
    expect(lines.some((line) => line.startsWith("Left out"))).toBe(false);
  });

  it("makes the package files and the stylesheet from the commit verify checked, never from the clone's disk", async () => {
    const dir = await moduleClone();
    // Written into the clone after the commit, by nothing that was checked.
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "x", version: "9.9.9", scripts: { prepare: "node evil.js" } }),
    );
    await fs.writeFile(path.join(dir, "package-lock.json"), '{"name":"x","lockfileVersion":3}');
    await fs.mkdir(path.join(dir, "res"));
    await fs.writeFile(path.join(dir, "res", "style.scss"), "evil { }");
    const clones = committed(dir, { "res/style.scss": "a { b: c }" });
    // The compile leaves more in the check folder than the stylesheet.
    const sass = fakeStyles({}, { "res/extra.js": "planted", "package.json": "{}" });
    const { ctx } = context({ dir, clones, styles: sass.styles });
    await run("prepare_deploy", ctx);
    expect(JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8"))).toEqual({
      name: "wafmodule-words",
      version: "1.0.0",
    });
    expect(asked(clones, "fileAt")).toEqual([
      [{ commit: HEAD }, "res/style.scss"],
      [{ commit: HEAD }, "package.json"],
      [{ commit: HEAD }, "package-lock.json"],
    ]);
    // The commit has no lock, so the one on disk is neither rewritten nor committed.
    expect(await fs.readFile(path.join(dir, "package-lock.json"), "utf8")).toBe(
      '{"name":"x","lockfileVersion":3}',
    );
    expect(await fs.readFile(path.join(dir, "res", "style.css"), "utf8")).toBe(
      "compiled(a { b: c })",
    );
    await expect(fs.stat(path.join(dir, "res", "extra.js"))).rejects.toThrow();
  });

  it("takes no stylesheet that is a link: another name of an outside file, or a symbolic one", async () => {
    const outside = path.join(await tempDir("wafh-deploy-outside-"), "secret.txt");
    await fs.writeFile(outside, "outside");
    const linkers: Array<(to: string) => Promise<void>> = [(to) => fs.link(outside, to)];
    // Making a symbolic link needs a privilege Windows does not give everyone.
    const probe = path.join(path.dirname(outside), "probe");
    if (
      await fs.symlink(outside, probe).then(
        () => true,
        () => false,
      )
    )
      linkers.push((to) => fs.symlink(outside, to));
    for (const link of linkers) {
      const dir = await moduleClone();
      const clones = committed(dir, { "res/style.scss": "a { b: c }" });
      const { ctx } = context({
        dir,
        clones,
        styles: async (job) => {
          await link(path.join(job.cwd, job.to));
          return { code: 0, tail: "" };
        },
      });
      await expect(run("prepare_deploy", ctx)).rejects.toMatchObject({
        error: { code: "command_failed", output: "The compile left no res/style.css." },
      });
      await expect(fs.stat(path.join(dir, "res", "style.css"))).rejects.toThrow();
    }
    expect(await fs.readFile(outside, "utf8")).toBe("outside");
  });

  it("writes the package files and the stylesheet as new files, never through a link in the clone", async () => {
    const dir = await moduleClone();
    const outside = path.join(await tempDir("wafh-deploy-outside-"), "linked.json");
    await fs.writeFile(outside, "outside");
    // package.json in the clone is another name of a file outside it.
    await fs.rm(path.join(dir, "package.json"));
    await fs.link(outside, path.join(dir, "package.json"));
    const clones = committed(dir, { "res/style.scss": "a { b: c }" });
    const { ctx } = context({ dir, clones, styles: fakeStyles().styles });
    await run("prepare_deploy", ctx);
    expect(await fs.readFile(outside, "utf8")).toBe("outside");
    expect(JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8"))).toMatchObject({
      name: "wafmodule-words",
    });
    expect((await fs.readdir(dir)).filter((file) => file.endsWith(".tmp"))).toEqual([]);
  });

  it("fails when the compile left no stylesheet, taking nothing from the check folder", async () => {
    const dir = await moduleClone();
    const clones = committed(dir, { "res/style.scss": "a { b: c }" });
    const { ctx } = context({
      dir,
      clones,
      styles: async (job) => {
        await fs.mkdir(path.join(job.cwd, job.to), { recursive: true });
        return { code: 0, tail: "" };
      },
    });
    await expect(run("prepare_deploy", ctx)).rejects.toMatchObject({
      error: { code: "command_failed", output: "The compile left no res/style.css." },
    });
    await expect(fs.stat(path.join(dir, "res", "style.css"))).rejects.toThrow();
    expect(clones.ops(dir)).not.toContain("commitStaged");
    expect(await checkFolders(ctx)).toEqual([]);
  });

  it("commits only the files it wrote: what was saved while verify_module's checks ran stays out", async () => {
    const dir = await moduleClone();
    // The studio saved a draft into the clone after verify_module committed and checked it.
    const unchecked = Array.from({ length: 22 }, (_, i) => `generated/words/scene-${i}.json`);
    const clones = fakeClones(dir, { changed: ["package.json", ...unchecked] });
    const { ctx, lines } = context({ dir, clones });
    await run("prepare_deploy", ctx);
    expect(asked(clones, "stage")).toEqual([[["package.json"], {}]]);
    expect(ctx.metadata.commit).toBe("0123abcd");
    expect(lines).toContain(
      `Left out of the deploy commit, changed since verify_module checked the module: ${unchecked.slice(0, 20).join(", ")} and 2 more.`,
    );
  });

  it("keeps the version, skips a missing stylesheet and commits nothing when nothing changed", async () => {
    const dir = await moduleClone();
    const clones = fakeClones(dir, { nothingStaged: true });
    const npx = fakeProcess();
    const sass = fakeStyles();
    const { ctx, lines } = context({ dir, clones, process: npx.process, styles: sass.styles });
    await run("prepare_deploy", ctx);
    expect(npx.calls).toEqual([]);
    expect(sass.jobs).toEqual([]);
    expect(lines).toContain("Nothing changed since the branch's last commit: nothing to commit.");
    expect(ctx.metadata).toEqual({ moduleVersion: "1.0.0" });
  });

  it("fails on a stylesheet that does not compile, with the compiler's words", async () => {
    const dir = await moduleClone();
    const clones = committed(dir, { "res/style.scss": "a { b: " });
    const sass = fakeStyles({ code: 65, tail: 'Error: expected "}".' });
    const { ctx } = context({ dir, clones, styles: sass.styles });
    await expect(run("prepare_deploy", ctx)).rejects.toMatchObject({
      error: {
        code: "command_failed",
        command: "sass@1.54.0 res/style.scss res/style.css --no-source-map",
        exitCode: 65,
        output: 'Error: expected "}".',
      },
    });
    expect(clones.ops(dir)).not.toContain("commitStaged");
    expect(await checkFolders(ctx)).toEqual([]);
  });
});

describe("the check folder", () => {
  /** A process that notes what the check folder holds as each program starts. */
  function noting(answer: (line: string) => Partial<DeployProcessResult> = () => ({})) {
    const seen: Array<{ line: string; files: string[] }> = [];
    const npm = fakeProcess(answer);
    const run = npm.process.run;
    npm.process.run = async (command, args, options) => {
      seen.push({ line: `${command} ${args.join(" ")}`, files: await fs.readdir(options.cwd!) });
      return run(command, args, options);
    };
    return { seen, npm };
  }

  it("holds the checked commit's files and no .git, made afresh and removed after the checks", async () => {
    const dir = await moduleClone();
    const { seen, npm } = noting();
    const clones = committed(dir, { "src/index.js": "export {};" });
    const { ctx } = context({ dir, clones, process: npm.process });
    // Left by checks a stopped server never finished.
    await fs.mkdir(ctx.module.checkDir, { recursive: true });
    await fs.writeFile(path.join(ctx.module.checkDir, "left.txt"), "");
    await run("verify_module", ctx);
    expect(seen.map((step) => step.line)).toEqual([
      "npm ci",
      "npm run buildDebug",
      "npm run lint",
      "npm run buildRelease",
    ]);
    // npm's own folder joins the commit's files; nothing else is there.
    expect(seen[0]!.files.sort()).toEqual([".npm-cache", "package.json", "src"]);
    expect(await checkFolders(ctx)).toEqual([]);
    // Outside the clone: nothing the checks write can be committed.
    expect(path.relative(dir, ctx.module.checkDir).startsWith("..")).toBe(true);
  });

  it("is removed when a check fails, and when Stop ends one", async () => {
    const dir = await moduleClone();
    const failing = context({
      dir,
      process: fakeProcess((line) => (line === "npm run lint" ? { code: 2 } : {})).process,
    });
    await expect(run("verify_module", failing.ctx)).rejects.toBeInstanceOf(DeployStageFailure);
    expect(await checkFolders(failing.ctx)).toEqual([]);

    const stopped = context({ dir });
    stopped.ctx.process = fakeProcess((line) => {
      if (line !== "npm run buildDebug") return {};
      stopped.controller.abort();
      return { code: null, error: "stopped" };
    }).process;
    await expect(run("verify_module", stopped.ctx)).rejects.toBeInstanceOf(DeployStopped);
    expect(await checkFolders(stopped.ctx)).toEqual([]);
  });

  it("is never one an earlier check had: every run of the checks gets a new folder", async () => {
    const dir = await moduleClone();
    const { seen, npm } = noting();
    const clones = committed(dir, { "res/style.scss": "a { b: c }" });
    const sass = fakeStyles();
    const { ctx } = context({ dir, clones, process: npm.process, styles: sass.styles });
    // A folder an earlier check ran in, which something it started may still be writing.
    const earlier = path.join(ctx.module.checkDir, "check-earlier");
    await fs.mkdir(earlier, { recursive: true });
    await run("verify_module", ctx);
    await run("prepare_deploy", ctx);
    const folders = [npm.calls[0]!.cwd!, sass.jobs[0]!.cwd];
    expect(new Set([...folders, earlier]).size).toBe(3);
    expect(seen).toHaveLength(4);
    expect(await checkFolders(ctx)).toEqual([]);
  });

  it("is removed when Stop ends the stylesheet compile", async () => {
    const dir = await moduleClone();
    const clones = committed(dir, { "res/style.scss": "a { b: c }" });
    const made = context({ dir, clones });
    made.ctx.styles = async () => {
      made.controller.abort();
      return { code: null, tail: "", error: "stopped" };
    };
    await expect(run("prepare_deploy", made.ctx)).rejects.toBeInstanceOf(DeployStopped);
    expect(await checkFolders(made.ctx)).toEqual([]);
    expect(clones.ops(dir)).not.toContain("commitStaged");
  });
});

/** A confiner that wraps what it confines in a runner, recording what it was asked. */
function fakeConfiner() {
  const calls: { argv: readonly string[]; opts: Parameters<SpawnConfiner>[1] }[] = [];
  const confiner: SpawnConfiner = (argv, opts) => {
    calls.push({ argv, opts });
    return { argv: ["sandbox-runner", ...argv] };
  };
  return { confiner, calls };
}

/** A clone whose commit holds a stylesheet, as prepare_deploy compiles it. */
async function styledClone() {
  const dir = await moduleClone();
  return { dir, clones: committed(dir, { "res/style.scss": "a { b: c }" }) };
}

describe("the module's own programs", () => {
  const SECRET = "WAFH_DEPLOY_BUILD_PROBE";
  const PROXY = "HTTPS_PROXY";
  const saved = { [SECRET]: process.env[SECRET], [PROXY]: process.env[PROXY] };
  afterEach(() => {
    for (const [name, value] of Object.entries(saved))
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  });

  it("run through the session sandbox while activity agents are confined, writable in the clone alone", async () => {
    const sandbox = fakeConfiner();
    const { dir, clones } = await styledClone();
    const npm = fakeProcess();
    const sass = fakeStyles();
    const { ctx } = context({
      dir,
      clones,
      process: npm.process,
      styles: sass.styles,
      confinement: () => sandbox.confiner,
    });
    await run("verify_module", ctx);
    await run("prepare_deploy", ctx);
    expect(npm.calls.map((call) => call.line)).toEqual([
      "npm ci",
      "npm run buildDebug",
      "npm run lint",
      "npm run buildRelease",
    ]);
    // Each program is started as the sandbox rewrites it.
    for (const call of npm.calls)
      expect(call.confine?.(["npm", "run", "x"]).argv).toEqual([
        "sandbox-runner",
        "npm",
        "run",
        "x",
      ]);
    expect(sass.jobs[0]!.confine?.(["node", "sass.js"]).argv).toEqual([
      "sandbox-runner",
      "node",
      "sass.js",
    ]);
    // Confined to the check folder, as an activity run's agent is to its workspace.
    // Each run of the checks has a folder of its own.
    const checks = npm.calls[0]!.cwd!;
    const compile = sass.jobs[0]!.cwd;
    expect(compile).not.toBe(checks);
    const confined = (cwd: string) => ({ cwd, workspaceDir: cwd, sessionMode: "workspace-write" });
    expect(sandbox.calls.map((call) => call.opts)).toEqual([
      ...Array(4).fill(confined(checks)),
      confined(compile),
    ]);
    // npm keeps its cache in the check folder, the one place it may write, gone after.
    const cache = path.join(checks, ".npm-cache");
    expect(npm.calls.every((call) => call.env?.npm_config_cache === cache)).toBe(true);
    expect(await checkFolders(ctx)).toEqual([]);
    // The Sass the compile waits for installs with nothing of the module's.
    expect(sass.jobs[0]).toMatchObject({ runModule: true });
  });

  it("start with none of this server's environment, the install with npm's network settings and no user config", async () => {
    process.env[SECRET] = "leaked";
    process.env[PROXY] = "http://proxy.example:3128";
    const { dir, clones } = await styledClone();
    // npm's folder, left in the clone by checks that once ran there.
    await fs.mkdir(path.join(dir, ".npm-cache", "_cacache"), { recursive: true });
    const npm = fakeProcess();
    const sass = fakeStyles();
    const { ctx } = context({
      dir,
      clones,
      process: npm.process,
      styles: sass.styles,
      confinement: () => fakeConfiner().confiner,
    });
    await run("verify_module", ctx);
    await run("prepare_deploy", ctx);
    for (const env of [...npm.calls.map((call) => call.env), sass.jobs[0]!.env]) {
      expect(env).toBeDefined();
      expect(env![SECRET]).toBeUndefined();
    }
    const [install, ...rest] = npm.calls;
    expect(install!.env![PROXY]).toBe("http://proxy.example:3128");
    for (const call of rest) expect(call.env![PROXY]).toBeUndefined();
    expect(sass.jobs[0]!.env![PROXY]).toBeUndefined();
    // npm ci read an empty user config of its own, not this server user's ~/.npmrc.
    expect(install!.userconfig).toBe("");
    expect(install!.env!.npm_config_userconfig).toBe(
      path.join(install!.cwd!, ".npm-cache", "user.npmrc"),
    );
    // Removed before the authored module was staged, so it never reaches a commit.
    await expect(fs.stat(path.join(dir, ".npm-cache"))).rejects.toThrow();
  });

  it("run unconfined once an admin turned confinement off, still without the server's environment", async () => {
    process.env[SECRET] = "leaked";
    const { dir, clones } = await styledClone();
    const npm = fakeProcess();
    const sass = fakeStyles();
    const { ctx } = context({ dir, clones, process: npm.process, styles: sass.styles });
    await run("verify_module", ctx);
    await run("prepare_deploy", ctx);
    for (const call of npm.calls) {
      expect(call.confine).toBeUndefined();
      expect(call.env![SECRET]).toBeUndefined();
      // npm keeps its cache in the user's profile, as npm unconfined does.
      expect(call.env!.npm_config_cache).toBeUndefined();
    }
    expect(npm.calls[0]!.userconfig).toBe("");
    expect(sass.jobs[0]!.confine).toBeUndefined();
    expect(sass.jobs[0]!.env![SECRET]).toBeUndefined();
    await expect(fs.stat(path.join(dir, ".npm-cache"))).rejects.toThrow();
  });

  it("are refused, the stage doing nothing, when they are to be confined and nothing can", async () => {
    const { dir, clones } = await styledClone();
    const npm = fakeProcess();
    const sass = fakeStyles();
    const { ctx, lines } = context({
      dir,
      clones,
      process: npm.process,
      styles: sass.styles,
      confinement: () => {
        throw sandboxUnavailable("no sandbox backend is mounted");
      },
    });
    for (const stage of ["verify_module", "prepare_deploy"] as const) {
      const failure = await run(stage, ctx).then(
        () => null,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(DeployStageFailure);
      expect((failure as DeployStageFailure).error).toEqual({ code: "sandbox_unavailable" });
    }
    // verify_module asks nothing of git; prepare_deploy only reads whether there is a stylesheet.
    expect(clones.ops(dir)).toEqual(["commitOf", "fileAt"]);
    expect(npm.calls).toEqual([]);
    expect(sass.jobs).toEqual([]);
    // The log says why, in the words an activity run is refused with.
    const said = lines.filter((line) => line.includes("Enable a sandbox plugin"));
    expect(said).toHaveLength(2);
    for (const line of said) expect(line).toContain("no sandbox backend is mounted");
  });

  it("ask nothing of the sandbox when prepare_deploy has no stylesheet to compile", async () => {
    const { ctx } = context({
      dir: await moduleClone(),
      confinement: () => {
        throw sandboxUnavailable("no sandbox backend is mounted");
      },
    });
    await run("prepare_deploy", ctx);
    expect(ctx.metadata.commit).toBe("0123abcd");
  });
});

describe("trigger_module_build", () => {
  it("notes the newest tag and build, pushes main when absent, pushes the branch and starts the job", async () => {
    const dir = await moduleClone();
    const clones = fakeClones(dir, {
      tags: [["v1.2.0", "1.10.0-beta", "1.1.9"]],
      remoteBranches: [],
    });
    const jenkins = fakeJenkins([{ state: "succeeded", number: 41 }]);
    const { ctx } = context({ dir, clones, jenkins: jenkins.jenkins });
    await run("trigger_module_build", ctx);
    expect(ctx.metadata).toEqual({
      preBuildTag: "1.2.0",
      preBuildNumber: 41,
      buildCommit: "0123abcd",
    });
    // The newest build, which has finished, is the floor the new one is looked for above.
    expect(jenkins.polls).toEqual([{ after: undefined }]);
    expect(asked(clones, "commitOf")).toEqual([["loom/words-deploy"]]);
    expect(clones.ops(dir)).toContain("fetchTags");
    expect(asked(clones, "push")).toEqual([
      ["main", {}],
      ["loom/words-deploy", { lease: true, track: true }],
    ]);
    expect(jenkins.triggers).toEqual([
      { job: "Build WAF Modules", params: { Modules: "words loom/words-deploy" } },
    ]);
  });

  it("leaves main alone when the remote has it, and stops at a refused push", async () => {
    const dir = await moduleClone();
    const clones = fakeClones(dir, { fail: { push: "! [rejected] (stale info)" } });
    const jenkins = fakeJenkins();
    const { ctx } = context({ dir, clones, jenkins: jenkins.jenkins });
    await expect(run("trigger_module_build", ctx)).rejects.toMatchObject({
      error: { code: "command_failed", output: "! [rejected] (stale info)" },
    });
    // Origin has main, so only the deploy branch was pushed.
    expect(asked(clones, "push")).toEqual([["loom/words-deploy", { lease: true, track: true }]]);
    expect(jenkins.triggers).toEqual([]);
  });

  it("names Jenkins's status when it refuses the build", async () => {
    const dir = await moduleClone();
    const jenkins = fakeJenkins();
    jenkins.jenkins.trigger = async () => {
      throw new JenkinsError(401);
    };
    const { ctx } = context({ dir, jenkins: jenkins.jenkins });
    await expect(run("trigger_module_build", ctx)).rejects.toMatchObject({
      error: { code: "jenkins_failed", status: 401 },
    });
  });

  it("starts no build beside one of the module still queued or going", async () => {
    const dir = await moduleClone();
    for (const going of [
      { state: "queued", url: "https://jenkins.example.org/queue/item/8/" },
      { state: "building", number: 42, url: "https://jenkins.example.org/job/x/42/" },
    ] as const) {
      const clones = fakeClones(dir);
      const jenkins = fakeJenkins([going]);
      const { ctx } = context({ dir, clones, jenkins: jenkins.jenkins });
      await expect(run("trigger_module_build", ctx)).rejects.toMatchObject({
        error: { code: "build_in_flight", url: going.url },
      });
      expect(asked(clones, "push")).toEqual([]);
      expect(jenkins.triggers).toEqual([]);
    }
  });

  // Started again after its wait was stopped, timed out or cut short by a restart: verify and
  // prepare ran again too, committing the same files anew.
  const again = {
    trigger_module_build: { preBuildTag: "1.2.0", preBuildNumber: 41, buildCommit: "c1" },
  };
  const sameFiles = { head: "c2", trees: { c1: "files", c2: "files" } };

  it("follows the build its last start began for the same files, still going or released", async () => {
    const dir = await moduleClone();
    const building: JenkinsBuildStatus = {
      state: "building",
      number: 42,
      url: "https://jenkins.example.org/job/x/42/",
    };
    const cases: Array<[JenkinsBuildStatus, string[]]> = [
      [building, ["1.2.0"]],
      [{ state: "succeeded", number: 42 }, ["1.2.0", "1.3.0"]],
    ];
    for (const [status, tags] of cases) {
      const clones = fakeClones(dir, { ...sameFiles, tags: [tags] });
      const jenkins = fakeJenkins([status]);
      const { ctx, lines } = context({ dir, clones, jenkins: jenkins.jenkins, earlier: again });
      await run("trigger_module_build", ctx);
      expect(ctx.metadata).toEqual({ preBuildTag: "1.2.0", preBuildNumber: 41, buildCommit: "c1" });
      expect(jenkins.polls).toEqual([{ after: 41 }]);
      expect(asked(clones, "push")).toEqual([]);
      expect(jenkins.triggers).toEqual([]);
      expect(
        lines.some((line) => line.endsWith("following it rather than starting another.")),
      ).toBe(true);
    }
    const clones = fakeClones(dir, { ...sameFiles, tags: [["1.2.0"]] });
    const { ctx, lines } = context({
      dir,
      clones,
      jenkins: fakeJenkins([building]).jenkins,
      earlier: again,
    });
    await run("trigger_module_build", ctx);
    expect(lines).toContain(
      "Jenkins has the build the last start began, building (https://jenkins.example.org/job/x/42/): following it rather than starting another.",
    );
  });

  it("starts a new build once the last one failed or released nothing of its commit", async () => {
    const dir = await moduleClone();
    const cases: Array<[JenkinsBuildStatus, Record<string, string[]>]> = [
      [{ state: "failed", number: 42, result: "FAILURE" }, {}],
      [{ state: "succeeded", number: 42 }, { "1.3.0": ["someone-else"] }],
    ];
    for (const [status, tagCommits] of cases) {
      const clones = fakeClones(dir, { ...sameFiles, tags: [["1.2.0", "1.3.0"]], tagCommits });
      const jenkins = fakeJenkins([status]);
      const { ctx } = context({ dir, clones, jenkins: jenkins.jenkins, earlier: again });
      await run("trigger_module_build", ctx);
      expect(jenkins.polls).toEqual([{ after: 41 }, { after: undefined }]);
      expect(jenkins.triggers).toHaveLength(1);
      expect(ctx.metadata).toEqual({ preBuildTag: "1.3.0", preBuildNumber: 42, buildCommit: "c2" });
    }
  });

  it("looks once more for the build its last start began when Jenkins lists it nowhere yet", async () => {
    const dir = await moduleClone();
    const building: JenkinsBuildStatus = {
      state: "building",
      number: 42,
      url: "https://jenkins.example.org/job/x/42/",
    };
    // Out of the queue and not listed yet, then listed: it is followed.
    const listed = fakeClock();
    const late = fakeJenkins([{ state: "unknown" }, building]);
    const followed = context({
      dir,
      clones: fakeClones(dir, { ...sameFiles, tags: [["1.2.0"]] }),
      jenkins: late.jenkins,
      clock: listed.clock,
      earlier: again,
    });
    await run("trigger_module_build", followed.ctx);
    expect(late.polls).toEqual([{ after: 41 }, { after: 41 }]);
    expect(listed.sleeps).toEqual([RECHECK_MS]);
    expect(late.triggers).toEqual([]);
    // Listed nowhere the second time either: the build is started again.
    const unlisted = fakeClock();
    const gone = fakeJenkins([{ state: "unknown" }]);
    const started = context({
      dir,
      clones: fakeClones(dir, { ...sameFiles, tags: [["1.2.0"]] }),
      jenkins: gone.jenkins,
      clock: unlisted.clock,
      earlier: again,
    });
    await run("trigger_module_build", started.ctx);
    expect(gone.polls).toEqual([{ after: 41 }, { after: 41 }, { after: undefined }]);
    expect(unlisted.sleeps).toEqual([RECHECK_MS]);
    expect(gone.triggers).toHaveLength(1);
  });

  it("follows nothing once the files changed or the last wait finished", async () => {
    const dir = await moduleClone();
    const building: JenkinsBuildStatus = {
      state: "building",
      number: 42,
      url: "https://jenkins.example.org/job/x/42/",
    };
    const changed = context({
      dir,
      clones: fakeClones(dir, { head: "c2", trees: { c1: "old", c2: "new" } }),
      jenkins: fakeJenkins([building]).jenkins,
      earlier: again,
    });
    // A build of the old files is still going: a second would run beside it.
    await expect(run("trigger_module_build", changed.ctx)).rejects.toMatchObject({
      error: { code: "build_in_flight", url: building.url },
    });
    const jenkins = fakeJenkins([{ state: "succeeded", number: 42 }]);
    const waited = context({
      dir,
      clones: fakeClones(dir, sameFiles),
      jenkins: jenkins.jenkins,
      earlier: { ...again, await_module_build: { resolvedModuleVersion: "1.3.0" } },
    });
    await run("trigger_module_build", waited.ctx);
    expect(jenkins.polls).toEqual([{ after: undefined }]);
    expect(jenkins.triggers).toHaveLength(1);
  });
});

describe("the module clone's queue", () => {
  it("runs every git command of the release in the module clone's queue, and npm outside it", async () => {
    const dir = await moduleClone();
    const clones = fakeClones(dir, { tags: [["1.2.0"], ["1.2.0", "1.3.0"]] });
    const jenkins = fakeJenkins([{ state: "unknown" }, { state: "succeeded", number: 42 }]);
    const { ctx } = context({ dir, clones, jenkins: jenkins.jenkins });
    // The checks take minutes: run in the queue, they would hold the workspace off as long.
    const npmIn: Array<string | null> = [];
    ctx.process = {
      run: async () => {
        npmIn.push(clones.inQueue);
        return { code: 0, tail: "" };
      },
    };
    for (const stage of [
      "verify_module",
      "prepare_deploy",
      "trigger_module_build",
      "await_module_build",
    ] as const)
      await run(stage, ctx);
    expect(ctx.metadata.resolvedModuleVersion).toBe("1.3.0");
    expect(clones.ops(dir).length).toBeGreaterThan(10);
    expect(clones.unqueued(dir)).toEqual([]);
    expect(new Set(clones.calls.map((call) => call.queue))).toEqual(new Set(["module"]));
    expect(npmIn).toEqual([null, null, null, null]);
  });
});

describe("await_module_build", () => {
  it("polls every 15 seconds until the build succeeds, then takes the newer tag that holds its commit", async () => {
    const dir = await moduleClone();
    // A newer tag is there while the build still runs: it is not taken for the release.
    const clones = fakeClones(dir, { tags: [["1.2.0", "1.3.0"]] });
    const jenkins = fakeJenkins([
      { state: "queued", url: "https://jenkins.example.org/queue/item/7/" },
      { state: "building", number: 42, url: "https://jenkins.example.org/job/x/42/" },
      { state: "succeeded", number: 42, url: "https://jenkins.example.org/job/x/42/" },
    ]);
    const time = fakeClock();
    const { ctx } = context({
      dir,
      clones,
      jenkins: jenkins.jenkins,
      clock: time.clock,
      earlier: {
        trigger_module_build: { preBuildTag: "1.2.0", preBuildNumber: 41, buildCommit: "c1" },
      },
    });
    await run("await_module_build", ctx);
    expect(ctx.metadata.resolvedModuleVersion).toBe("1.3.0");
    expect(ctx.metadata.moduleBuildUrl).toBe("https://jenkins.example.org/job/x/42/");
    expect(ctx.metadata.buildCommit).toBe("c1");
    expect(time.sleeps).toEqual([15_000, 15_000]);
    expect(jenkins.polls.every((poll) => poll.after === 41)).toBe(true);
    expect(asked(clones, "fetchTags")).toHaveLength(1);
    expect(asked(clones, "tagHolds")).toEqual([["1.3.0", "c1"]]);
  });

  it("takes the oldest newer tag that holds the commit, and fails when none does", async () => {
    const dir = await moduleClone();
    const earlier = {
      trigger_module_build: { preBuildTag: "1.2.0", preBuildNumber: 41, buildCommit: "c1" },
    };
    const tags = [["1.2.0", "1.3.0", "v1.3.1", "1.4.0", "1.1.0"]];
    const released = context({
      dir,
      clones: fakeClones(dir, {
        tags,
        tagCommits: { "1.3.0": ["manual"], "v1.3.1": ["c1"], "1.4.0": ["c1", "later"] },
      }),
      jenkins: fakeJenkins([{ state: "succeeded", number: 42 }]).jenkins,
      earlier,
    });
    await run("await_module_build", released.ctx);
    expect(released.ctx.metadata.resolvedModuleVersion).toBe("1.3.1");
    // Every newer tag was made by other builds: none is this one's release.
    const others = context({
      dir,
      clones: fakeClones(dir, { tags, tagCommits: { "1.3.0": [], "v1.3.1": [], "1.4.0": [] } }),
      jenkins: fakeJenkins([{ state: "succeeded", number: 42 }]).jenkins,
      earlier,
    });
    await expect(run("await_module_build", others.ctx)).rejects.toMatchObject({
      error: { code: "tag_without_commit", tag: "1.4.0", commit: "c1" },
    });
  });

  it("takes a tag that does not hold the commit only when it has the commit's files, a version bump apart", async () => {
    const dir = await moduleClone();
    const pkg = (version: string) =>
      `{\n  "name": "wafmodule-words",\n  "version": "${version}"\n}\n`;
    const lock = (version: string) =>
      JSON.stringify({ name: "wafmodule-words", version, packages: { "": { version } } });
    const built = {
      "src/index.js": "export {};",
      "res/style.css": "a{}",
      "package.json": pkg("1.2.0"),
      "package-lock.json": lock("1.2.0"),
    };
    const released = async (tagged: Record<string, string>, ancestor = false) => {
      const { ctx, lines } = context({
        dir,
        clones: fakeClones(dir, {
          tags: [["1.2.0", "1.3.0"]],
          tagCommits: { "1.3.0": ancestor ? ["c1"] : ["squashed"] },
          files: { c1: built, "1.3.0": tagged },
        }),
        jenkins: fakeJenkins([{ state: "succeeded", number: 42 }]).jenkins,
        earlier: {
          trigger_module_build: { preBuildTag: "1.2.0", preBuildNumber: 41, buildCommit: "c1" },
        },
      });
      await run("await_module_build", ctx);
      return { version: ctx.metadata.resolvedModuleVersion, log: lines.at(-1) };
    };
    // The build tagged the commit, or one it made on top of it.
    expect(await released({}, true)).toEqual({
      version: "1.3.0",
      log: "Released as 1.3.0: tag 1.3.0 holds c1.",
    });
    // The build squashed or rebased it: the same files, and a file of its own beside them.
    const sameFiles = /^Released as 1\.3\.0: tag 1\.3\.0 does not hold c1 but has its files/;
    const squashed = await released({ ...built, "CHANGELOG.md": "1.3.0" });
    expect(squashed.version).toBe("1.3.0");
    expect(squashed.log).toMatch(sameFiles);
    // It bumped the version as it did.
    const bumped = await released({
      ...built,
      "package.json": pkg("1.3.0"),
      "package-lock.json": lock("1.3.0"),
    });
    expect(bumped.version).toBe("1.3.0");
    expect(bumped.log).toMatch(sameFiles);
    // A tag on other content is not this build's release: a source changed, package.json
    // changed past its version, or files the commit has missing.
    for (const other of [
      { ...built, "src/index.js": "export default 1;" },
      { ...built, "package.json": pkg("1.3.0").replace("wafmodule-words", "wafmodule-other") },
      { "src/index.js": "export {};", "package.json": pkg("1.3.0") },
    ])
      await expect(released(other)).rejects.toMatchObject({
        error: { code: "tag_without_commit", tag: "1.3.0", commit: "c1" },
      });
  });

  it("looks for the deploy branch's commit when the start was recorded before commits were", async () => {
    const dir = await moduleClone();
    const clones = fakeClones(dir, {
      head: "c9",
      tags: [["1.2.0", "1.3.0"]],
      tagCommits: { "1.3.0": ["c9"] },
    });
    const { ctx } = context({
      dir,
      clones,
      jenkins: fakeJenkins([{ state: "succeeded", number: 42 }]).jenkins,
      earlier: { trigger_module_build: { preBuildTag: "1.2.0", preBuildNumber: 41 } },
    });
    await run("await_module_build", ctx);
    expect(asked(clones, "commitOf")).toEqual([["loom/words-deploy"]]);
    expect(ctx.metadata).toMatchObject({ resolvedModuleVersion: "1.3.0", buildCommit: "c9" });
  });

  it("takes a first tag as new when the module had none", async () => {
    const dir = await moduleClone();
    const { ctx } = context({
      dir,
      clones: fakeClones(dir, { tags: [["0.1.0"]] }),
      jenkins: fakeJenkins([{ state: "succeeded", number: 1 }]).jenkins,
      metadata: { preBuildTag: null, preBuildNumber: null, buildCommit: "c1" },
    });
    await run("await_module_build", ctx);
    expect(ctx.metadata.resolvedModuleVersion).toBe("0.1.0");
  });

  it("fails when the build fails, when it succeeds with no new tag, and when time runs out", async () => {
    const dir = await moduleClone();
    const earlier = { trigger_module_build: { preBuildTag: "1.2.0", preBuildNumber: null } };
    const failed = context({
      dir,
      clones: fakeClones(dir, { tags: [["1.2.0"]] }),
      jenkins: fakeJenkins([{ state: "failed", result: "FAILURE", url: "https://j/x/1/" }]).jenkins,
      earlier,
    });
    await expect(run("await_module_build", failed.ctx)).rejects.toMatchObject({
      error: { code: "build_failed", result: "FAILURE", url: "https://j/x/1/" },
    });
    const untagged = context({
      dir,
      clones: fakeClones(dir, { tags: [["1.2.0", "1.1.0"]] }),
      jenkins: fakeJenkins([{ state: "succeeded" }]).jenkins,
      earlier,
    });
    await expect(run("await_module_build", untagged.ctx)).rejects.toMatchObject({
      error: { code: "no_newer_tag", before: "1.2.0", after: "1.2.0" },
    });
    const time = fakeClock();
    // A newer tag that some other build made while this one ran is never taken for it.
    const slow = context({
      dir,
      clones: fakeClones(dir, { tags: [["1.2.0", "1.3.0"]] }),
      jenkins: fakeJenkins([{ state: "building" }]).jenkins,
      clock: time.clock,
      earlier,
    });
    await expect(run("await_module_build", slow.ctx)).rejects.toMatchObject({
      error: { code: "build_timed_out", minutes: 1 },
    });
    expect(time.sleeps).toHaveLength(4);
  });

  it("needs the trigger stage's note of the tag before the build", async () => {
    const dir = await moduleClone();
    const { ctx } = context({ dir });
    await expect(run("await_module_build", ctx)).rejects.toMatchObject({
      error: { code: "missing_input", stage: "trigger_module_build" },
    });
  });

  it("stops when the engineer presses Stop while it waits", async () => {
    const dir = await moduleClone();
    const holder: { controller?: AbortController } = {};
    const made = context({
      dir,
      clones: fakeClones(dir, { tags: [["1.2.0"]] }),
      jenkins: fakeJenkins([{ state: "building" }]).jenkins,
      earlier: { trigger_module_build: { preBuildTag: "1.2.0" } },
      clock: {
        now: () => 0,
        async sleep() {
          holder.controller!.abort();
        },
      },
    });
    holder.controller = made.controller;
    await expect(run("await_module_build", made.ctx)).rejects.toBeInstanceOf(DeployStopped);
  });
});

describe("Stop during git", () => {
  it("hands the clone the run's signal, so Stop ends a push that is still going", async () => {
    const dir = await moduleClone();
    const clones = fakeClones(dir);
    const seen: Array<AbortSignal | undefined> = [];
    const open = clones.open.bind(clones);
    clones.open = (where: string, options?: CloneOptions) => {
      seen.push(options?.signal);
      const clone = open(where, options);
      // A push that only ends when its signal aborts, as a real clone stops git.
      clone.push = () =>
        new Promise((_, reject) =>
          options?.signal?.addEventListener("abort", () => reject(new CloneStopped())),
        );
      return clone;
    };
    const made = context({ dir, clones });
    const pending = run("trigger_module_build", made.ctx);
    await new Promise((resolve) => setTimeout(resolve, 10));
    made.controller.abort();
    await expect(pending).rejects.toBeInstanceOf(DeployStopped);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((signal) => signal === made.controller.signal)).toBe(true);
  });

  it("ends a stage with git's failure: missing, timed out, or failed with its output", async () => {
    const dir = await moduleClone();
    const args = ["fetch", "--tags", "origin"];
    const failing = (result: DeployGitResult) => {
      const clones = fakeClones(dir);
      const open = clones.open.bind(clones);
      clones.open = (where: string, options?: CloneOptions) => {
        const clone = open(where, options);
        clone.fetchTags = () => Promise.reject(new CloneError(args, result));
        return clone;
      };
      return context({ dir, clones }).ctx;
    };
    const missing = failing({ code: null, stdout: "", stderr: "", error: "not_found" });
    await expect(run("trigger_module_build", missing)).rejects.toMatchObject({
      error: { code: "command_missing", command: "git" },
    });
    const slow = failing({ code: null, stdout: "", stderr: "", error: "timed_out" });
    await expect(run("trigger_module_build", slow)).rejects.toMatchObject({
      error: { code: "command_timed_out", command: "git fetch --tags origin" },
    });
    const refused = failing({ code: 128, stdout: "", stderr: "fatal: unable to access" });
    await expect(run("trigger_module_build", refused)).rejects.toMatchObject({
      error: {
        code: "command_failed",
        command: "git fetch --tags origin",
        exitCode: 128,
        output: "fatal: unable to access",
      },
    });
  });
});

describe("stage blockers", () => {
  const ready: DeployContext = {
    ready: true,
    problems: [],
    remoteChecked: false,
    module: {
      folder: "waf-module-words",
      remote: "git@github.com:org/waf-module-words.git",
      clone: { present: true, branch: "main", clean: true, ahead: 0, remoteUrlMatches: true },
    },
    activityData: {
      clone: { present: true, branch: "main", clean: true, ahead: 0, remoteUrlMatches: true },
    },
    media: {
      clone: { present: true, branch: "main", clean: true, ahead: 0, remoteUrlMatches: true },
    },
    branches: { deploy: "loom/words-deploy", activityData: "loom/words-activity-data" },
    branchState: {
      deploy: { local: null, remote: null },
      activityData: { local: null, remote: null },
    },
  };

  it("lets the first stage run on a ready deploy, and each later one after the one before", () => {
    expect(stageBlocker("verify_module", ready, {}, false)).toBeNull();
    expect(stageBlocker("trigger_module_build", ready, { verify_module: "done" }, false)).toEqual({
      code: "previous_stage",
      stage: "prepare_deploy",
    });
    expect(
      stageBlocker("trigger_module_build", ready, { prepare_deploy: "done" }, false),
    ).toBeNull();
    expect(stageBlocker("prepare_deploy", ready, { verify_module: "failed" }, false)).toEqual({
      code: "previous_stage",
      stage: "verify_module",
    });
    expect(stageBlocker("verify_module", ready, {}, true)).toEqual({ code: "run_active" });
  });

  it("lists every problem that keeps the stages from starting, and none a stage tolerates", () => {
    const problems: DeployContext["problems"] = [
      { code: "clone_dirty", repo: "module" },
      { code: "settings_missing", field: "qa.jenkinsUrl" },
      { code: "clone_ahead", repo: "activityData", count: 2 },
      { code: "branch_missing", repo: "module", branch: "main", where: "local" },
      { code: "clone_unknown", repo: "media", what: "branch" },
    ];
    const context = { ...ready, ready: false, problems };
    expect(startProblems(context)).toEqual([
      { code: "settings_missing", field: "qa.jenkinsUrl" },
      { code: "branch_missing", repo: "module", branch: "main", where: "local" },
      { code: "clone_unknown", repo: "media", what: "branch" },
    ]);
    // A stage's own blocker names only the first of them.
    expect(stageBlocker("verify_module", context, {}, false)).toEqual({
      code: "settings_missing",
      field: "qa.jenkinsUrl",
    });
    expect(startProblems(ready)).toEqual([]);
  });

  it("runs prepare once per verify: its content is what verify left in the working tree", () => {
    for (const status of ["done", "failed", "cancelled"] as const)
      expect(
        stageBlocker(
          "prepare_deploy",
          ready,
          { verify_module: "done", prepare_deploy: status },
          false,
        ),
      ).toEqual({ code: "previous_rerun", stage: "verify_module" });
    expect(
      stageBlocker(
        "prepare_deploy",
        ready,
        { verify_module: "done", prepare_deploy: "pending" },
        false,
      ),
    ).toBeNull();
    // The stages after it may run again as often as needed.
    expect(
      stageBlocker(
        "trigger_module_build",
        ready,
        { prepare_deploy: "done", trigger_module_build: "failed" },
        false,
      ),
    ).toBeNull();
  });

  it("names the readiness problem, and lets every stage past the module clone's own changes", () => {
    const dirty: DeployContext = {
      ...ready,
      ready: false,
      problems: [
        { code: "clone_dirty", repo: "module" },
        { code: "clone_ahead", repo: "module", count: 1 },
        { code: "clone_unknown", repo: "module", what: "upstream" },
      ],
    };
    // A failed or stopped verify leaves its copied files behind; verify itself clears them.
    expect(stageBlocker("verify_module", dirty, { verify_module: "failed" }, false)).toBeNull();
    expect(stageBlocker("prepare_deploy", dirty, { verify_module: "done" }, false)).toBeNull();
    // The activity-data and media clones are put back as origin has them by the stages that
    // work in them, so what a failed export or media copy left there does not block either.
    const otherDirty: DeployContext = {
      ...ready,
      ready: false,
      problems: [
        { code: "clone_dirty", repo: "activityData" },
        { code: "clone_ahead", repo: "media", count: 2 },
      ],
    };
    expect(stageBlocker("verify_module", otherDirty, {}, false)).toBeNull();
    const otherRemote: DeployContext = {
      ...ready,
      ready: false,
      problems: [{ code: "clone_remote_mismatch", repo: "activityData" }],
    };
    expect(stageBlocker("verify_module", otherRemote, {}, false)).toEqual({
      code: "not_ready",
      problem: { code: "clone_remote_mismatch", repo: "activityData" },
    });
    // Work a deploy left in a stash is in no working tree a stage commits: nothing starts.
    const stashLeft: DeployContext = {
      ...ready,
      ready: false,
      problems: [{ code: "clone_stash_left", repo: "module" }],
    };
    expect(stageBlocker("verify_module", stashLeft, {}, false)).toEqual({
      code: "not_ready",
      problem: { code: "clone_stash_left", repo: "module" },
    });
    const unset: DeployContext = {
      ...ready,
      ready: false,
      problems: [{ code: "settings_missing", field: "qa.token" }, { code: "not_canonical" }],
    };
    expect(stageBlocker("await_module_build", unset, {}, false)).toEqual({
      code: "settings_missing",
      field: "qa.token",
    });
    expect(
      stageBlocker(
        "verify_module",
        { ...ready, ready: false, problems: [{ code: "not_canonical" }] },
        {},
        false,
      ),
    ).toEqual({ code: "not_ready", problem: { code: "not_canonical" } });
  });
});
