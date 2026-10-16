/**
 * The stages of a module release, each a step over injected ports, and which of them may run
 * now.
 *
 *   verify_module         put the module clone on main as origin has it, carrying the authored
 *                         work in its working tree, copy the newest assembled module over it,
 *                         commit all of it on main, and run `npm ci`, `npm run buildDebug`,
 *                         `npm run lint` and `npm run buildRelease` on that commit (in its
 *                         check folder, below)
 *   prepare_deploy        make the deploy branch from main's commit, carrying the working tree;
 *                         write the package name and version into that commit's package.json
 *                         and lock; compile its `res/style.scss` when it has one (in its check
 *                         folder, with the pinned Sass the preview uses too, `module-builder.ts`)
 *                         and take the `res/style.css` that made; commit those files as the
 *                         configured identity (nothing to commit is not a failure), and name what
 *                         else changed since verify_module, which stays out
 *   trigger_module_build  note the newest release tag, Jenkins build and deploy branch commit,
 *                         push main when the remote lacks it, push the deploy branch, and start
 *                         the module build
 *   await_module_build    every 15 seconds, follow that build until it succeeds, fails, or the
 *                         configured minutes pass; once it succeeded, take the newer release tag
 *                         that holds the commit it was started for
 *
 * and the QA deploy after it:
 *
 *   export_activity_data     put the activity-data clone on `loom/<pc>-activity-data` as origin
 *                            has it (from main when origin has no such branch) and write every
 *                            deployed ref's configuration and assessment, the template and the
 *                            deploy list into it (`deploy-export.ts`)
 *   verify_activity_data     check what was written (`deploy-preflight.ts`); errors fail it
 *   verify_media_assets      bring the media clone's main up to origin around the authored media,
 *                            fail naming any file the data names that is nowhere, then commit the
 *                            new or changed ones and push main (`deploy-media.ts`)
 *   publish_activity_data    commit what export wrote and push the branch
 *   trigger_activity_deploy  note the newest activity deploy build, and start the activity
 *                            deploy job for the branch and this product's template
 *   await_activity_deploy    every 15 seconds, follow that build until it succeeds, fails, or
 *                            the configured minutes pass; record where the activity opens on QA
 *
 * and, once QA has the activity as it is now, the PROD deploy:
 *
 *   trigger_production_deploy   start the same activity deploy job on the PROD Jenkins, for the
 *                               branch QA deployed, with PROD's tier, environment and framework
 *                               version
 *   await_production_deploy     follow that deploy as await_activity_deploy follows QA's, and
 *                               record when PROD got it
 *
 * A trigger run again after its wait did not finish (stopped, timed out, or cut short by a
 * restart) starts nothing when what it would start is what it started last and Jenkins still
 * has that build queued or going, or finished with success: the wait after it follows that
 * build. Any other build with the same parameters still queued or going fails the trigger, since
 * a second would run beside it (`startOrFollow`).
 *
 * Everything runs in the WAF workspace's clones. The module and media clones hold authored
 * work, which the stages commit rather than discard; the activity-data clone is the deploy's
 * own and must be clean. The git work a stage does on the module or media clone waits for, and
 * holds off, the workspace's own git work on that repository (`serial`); the npm checks, the
 * stylesheet compile and Jenkins run outside it. The clones, that queue, Jenkins, the programs,
 * the stylesheet compiler, the sandbox and the clock are ports, so a test runs every stage with
 * fakes and nothing reaches a remote.
 *
 * The npm checks and the stylesheet compile run the module's own code (its package.json
 * scripts, its webpack config, what `npm ci` installs), which a run's agent may have written.
 * So they run in the module's check folder (`DeployStageContext.module.checkDir`), never in the
 * clone: a folder of Penguin's own outside every clone, made afresh for each run of them from
 * the commit they check (`Clone.exportTo`), holding no `.git`, and removed once they end however
 * they end. There they start as a build of a run's module does (`runBuildSpawn`): with none of
 * this server's environment and, while activity agents are confined, through the session
 * sandbox, writable in the check folder alone; with nothing able to confine them then, the stage
 * fails before it does anything. What they leave there reaches the release only as the
 * stylesheet compile's `res/style.css`. `npm ci` keeps the module's own `.npmrc`, the one the
 * release build installs with, but none of this server's npm user config. git and Jenkins keep
 * the clone's credentials and are never confined; nothing they read was written by the module's
 * code, and git runs none of the programs a repository's own config could name (`deploy-git.ts`).
 */
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { SpawnConfiner } from "@prismshadow/penguin-core";
import { HttpError } from "../http/errors.js";
import {
  CloneError,
  CloneStopped,
  repositoryMissing,
  type Clone,
  type CloneIdentity,
  type Clones,
} from "./clone.js";
import { BASE_BRANCH, activityDataBranchName, deployBranchName } from "./deploy-git.js";
import { moduleShortName } from "./waf-layout.js";
import type { DeployJenkins, JenkinsBuildStatus } from "./deploy-jenkins.js";
import { JenkinsError } from "./deploy-jenkins.js";
import type { DeployProcess, DeployProcessResult } from "./deploy-process.js";
import { SASS_PACKAGE, type StyleCompiler } from "./module-builder.js";
import type { DeploySettings } from "./deploy-settings.js";
import {
  ExportLayoutError,
  exportFiles,
  mainModule,
  deployedRefs,
  type ExportRef,
} from "./deploy-export.js";
import { runPreflight } from "./deploy-preflight.js";
import { syncMedia } from "./deploy-media.js";
import { withinRoot } from "./sandbox-paths.js";
import { RUN_BUILD_NPM_CACHE } from "./sandbox-source.js";
import { runBuildEnv, runBuildSpawn, type RunBuildSpawn } from "./sandbox-build-runner.js";
import {
  DEPLOY_ALL_STAGES,
  DEPLOY_PROD_STAGES,
  DEPLOY_QA_STAGES,
  DEPLOY_RELEASE_STAGES,
  DEPLOY_STAGES,
  type DeployBlocker,
  type DeployContext,
  type DeployProblem,
  type DeployRunMetadata,
  type DeployStage,
  type DeployStageError,
  type DeployStageSelection,
  type DeployStageStatus,
  type DeployTarget,
} from "./deploy-types.js";

/** The module checks a release runs, in order: install, both builds, and lint between them. */
export const MODULE_VERIFY_COMMANDS: readonly (readonly string[])[] = [
  ["ci"],
  ["run", "buildDebug"],
  ["run", "lint"],
  ["run", "buildRelease"],
];

/** How often the build is looked at while waiting for it. */
export const BUILD_POLL_MS = 15_000;

/** How long a push may take. */
export const PUSH_TIMEOUT_MS = 5 * 60 * 1000;

/** How many paths a failure, the metadata or a log line names at most. */
const PATHS_SHOWN = 20;

/**
 * How long a retried trigger waits to read Jenkins again when the build its last start began is
 * neither queued nor listed: Jenkins lists a build a moment after it leaves the queue.
 */
export const RECHECK_MS = 5_000;

/** A release version: plain semver, as the module's tags are. */
const SEMVER = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Whether a version an engineer typed is one a module can be released as. */
export function isModuleVersion(value: string): boolean {
  return SEMVER.test(value) && !value.startsWith("v");
}

/** A tag as a plain version (`v1.2.3` → `1.2.3`); null when it is not plain semver. */
export function plainSemver(tag: string): string | null {
  const match = SEMVER.exec(tag.trim());
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

export function compareSemver(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < 3; index++)
    if (left[index] !== right[index]) return left[index]! - right[index]!;
  return 0;
}

/** The newest plain semver among `tags`, normalised; null when none is. */
export function latestSemver(tags: readonly string[]): string | null {
  let best: string | null = null;
  for (const tag of tags) {
    const version = plainSemver(tag);
    if (version && (best === null || compareSemver(version, best) > 0)) best = version;
  }
  return best;
}

/** The npm package name a module is published under (`waf-module-Abc` → `wafmodule-abc`). */
export function modulePackageName(moduleFolder: string): string {
  return `wafmodule-${moduleShortName(moduleFolder).toLowerCase()}`;
}

/** The `Modules` parameter the module build job takes: the module's short name and branch. */
export function moduleBuildLine(moduleFolder: string): string {
  return `${moduleShortName(moduleFolder)} ${deployBranchName(moduleFolder)}`;
}

/** The deploy's clock: tests wait no real time. */
export interface DeployClock {
  now(): number;
  /** Resolves after `ms`, or as soon as `signal` aborts. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export const realClock: DeployClock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      if (signal.aborted) return resolve();
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        resolve();
      }
      signal.addEventListener("abort", done, { once: true });
    }),
};

/** The activity as a QA deploy exports it, read when the export runs. */
export interface DeployActivitySnapshot {
  /** The deploying (canonical) ref's title, layout and theme, which the template carries. */
  title: string;
  layout: string | null;
  theme: string | null;
  /** The deploying ref's draft revision, recorded as what went to QA. */
  contentRevision: string;
  /** Every exported ref's revision as one (`exportRevision`), which the PROD gate compares. */
  productRevision: string;
  /** Every ref of the product; archived ones are left out of the export. */
  refs: ExportRef[];
}

/** What the QA stages work on besides the module. */
export interface DeployQaContext {
  /** The activity-data clone. */
  activityData: { dir: string };
  /** The media clone. */
  media: { dir: string };
  /** The deploying ref's number, which the link to QA opens. */
  refNum: number;
  /** Where the deploy goes: the target's Jenkins job settings and the QA address. */
  target: { tier: string; environment: string; frameworkVersion: string; activityBaseUrl: string };
  snapshot(): Promise<DeployActivitySnapshot>;
}

/** Where an activity deploy job runs: the target's tier, environment and framework version. */
export interface DeployJobTarget {
  tier: string;
  environment: string;
  frameworkVersion: string;
}

/** What the PROD stages work on: PROD's job settings. Jenkins is PROD's for such a run. */
export interface DeployProdContext {
  target: DeployJobTarget;
}

export interface DeployStageContext {
  /** The clones the stages work in. */
  clones: Clones;
  /**
   * Runs git work on the module clone or the media clone once no other git work on that
   * repository is going on this server, and holds it off until `work` settles.
   */
  serial<T>(repo: "module" | "media", work: () => Promise<T>): Promise<T>;
  jenkins: DeployJenkins;
  process: DeployProcess;
  /** Compiles a module's stylesheet with the pinned Sass, as the preview does. */
  styles: StyleCompiler;
  /**
   * How the module's own programs are to run, asked as a stage that runs them starts: the
   * session sandbox's confiner, or null once an admin turned confinement off. Throws the
   * `sandbox_unavailable` refusal when they are to be confined and nothing can
   * (`runConfinement`).
   */
  confinement(): SpawnConfiner | null;
  clock: DeployClock;
  settings: DeploySettings;
  productCode: string;
  module: {
    folder: string;
    /** The module's deploy clone. */
    dir: string;
    /**
     * Where the module's checks run (see the top of this file): a folder outside every clone,
     * in which each run of them gets a folder of its own; whatever is there when one starts is
     * a stopped server's.
     */
    checkDir: string;
    /** The newest assembled module to copy over the clone; null to deploy the clone as it is. */
    source: string | null;
    /** What that module's content hashes to; null (or absent) when there is none. */
    contentHash?: string | null;
    /** The module build `source` is, when it is one. */
    runId?: string;
  };
  /** The activity-data and media side of a QA deploy; absent for a run that cannot reach it. */
  qa?: DeployQaContext;
  /** The PROD side of a PROD deploy; absent for every other run. */
  prod?: DeployProdContext;
  /** The version to write into package.json; null keeps the one there. */
  moduleVersion: string | null;
  /** What this run found out so far; stages add to it. */
  metadata: DeployRunMetadata;
  /** What each stage recorded when it last finished, for a stage run on its own. */
  earlier: Partial<Record<DeployStage, DeployRunMetadata>>;
  log(text: string): void;
  signal: AbortSignal;
}

/** A stage that ended badly, with the facts of why. */
export class DeployStageFailure extends Error {
  constructor(readonly error: DeployStageError) {
    super(error.code);
    this.name = "DeployStageFailure";
  }
}

/** The engineer pressed Stop. */
export class DeployStopped extends Error {
  constructor() {
    super("stopped");
    this.name = "DeployStopped";
  }
}

export interface DeployStageDefinition {
  id: DeployStage;
  run(ctx: DeployStageContext): Promise<void>;
}

function checkStopped(ctx: DeployStageContext) {
  if (ctx.signal.aborted) throw new DeployStopped();
}

/** Output handed on as whole lines; the last partial line waits for the rest of it. */
function lineWriter(log: (text: string) => void) {
  let pending = "";
  return {
    write(text: string) {
      pending += text;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) if (line.trim() !== "") log(line);
    },
    flush() {
      if (pending.trim() !== "") log(pending);
      pending = "";
    },
  };
}

/**
 * A clone the stage works in: each git command and what git said go to the deploy log, Stop
 * stops it, and a command that reaches the remote gets as long as a push.
 */
function cloneOf(ctx: DeployStageContext, dir: string): Clone {
  return ctx.clones.open(dir, {
    log: ctx.log,
    signal: ctx.signal,
    networkTimeoutMs: PUSH_TIMEOUT_MS,
  });
}

/** The identity the stages commit as. */
function identityOf(ctx: DeployStageContext): CloneIdentity {
  return { name: ctx.settings.git.userName, email: ctx.settings.git.userEmail };
}

/** A git command that failed, as the stage's failure. */
function gitFailure(error: CloneError): DeployStageFailure {
  const { command, result } = error;
  if (result.error === "not_found")
    return new DeployStageFailure({ code: "command_missing", command: "git" });
  if (result.error === "timed_out")
    return new DeployStageFailure({ code: "command_timed_out", command });
  return new DeployStageFailure({
    code: "command_failed",
    command,
    exitCode: result.code,
    output: tailOf(`${result.stdout}\n${result.stderr}`),
  });
}

/** A stage whose git failures end it as stage failures, and whose Stop is the run's. */
function speakingGit(stage: DeployStageDefinition): DeployStageDefinition {
  return {
    id: stage.id,
    async run(ctx) {
      try {
        await stage.run(ctx);
      } catch (error) {
        if (error instanceof CloneStopped) throw new DeployStopped();
        if (error instanceof CloneError) throw gitFailure(error);
        throw error;
      }
    },
  };
}

function tailOf(text: string): string {
  return text.trim().split(/\r?\n/).slice(-20).join("\n");
}

/**
 * What confines the module's own programs (see the top of this file), null while they run
 * unconfined. Fails the stage when they are to be confined and nothing can confine them, the
 * refusal's words in the log.
 */
function moduleConfiner(ctx: DeployStageContext): SpawnConfiner | null {
  try {
    return ctx.confinement();
  } catch (error) {
    if (!(error instanceof HttpError) || error.code !== "sandbox_unavailable") throw error;
    ctx.log(error.message);
    throw new DeployStageFailure({ code: "sandbox_unavailable" });
  }
}

/**
 * Runs `work` in a check folder holding `commit`'s files (see the top of this file): a folder
 * of its own under the module's `checkDir`, so nothing an earlier check left running can reach
 * it, removed once `work` ends, however it ends.
 */
async function inCheckFolder<T>(
  ctx: DeployStageContext,
  clone: Clone,
  commit: string,
  work: (dir: string) => Promise<T>,
): Promise<T> {
  const root = ctx.module.checkDir;
  await fs.mkdir(root, { recursive: true });
  // Whatever is there was left by checks a stopped server never finished.
  for (const stale of await fs.readdir(root)) await removeCheckFolder(path.join(root, stale));
  const dir = await fs.mkdtemp(path.join(root, "check-"));
  try {
    await ctx.serial("module", () => clone.exportTo(commit, dir));
    return await work(dir);
  } finally {
    await removeCheckFolder(dir);
  }
}

/** Removes a check folder; Windows may still be letting go of a stopped program's files. */
function removeCheckFolder(dir: string): Promise<void> {
  return fs.rm(dir, { recursive: true, force: true, maxRetries: 5 });
}

/** Whether `target` is `root` or inside it. */
function inside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Writes `data` to `file` in the module clone `root` as a new file renamed into place, so a
 * link already there (symbolic or hard) is replaced, never written through, and only into a
 * folder that really is inside the clone.
 */
async function writeInClone(root: string, file: string, data: string | Buffer): Promise<void> {
  const target = path.join(root, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const [realRoot, realFolder] = await Promise.all([
    fs.realpath(root),
    fs.realpath(path.dirname(target)),
  ]);
  if (!inside(realRoot, realFolder)) throw new Error(`${file} is not inside the module clone.`);
  const temp = `${target}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, data, { flag: "wx" });
  try {
    await fs.rename(temp, target);
  } catch (error) {
    await fs.rm(temp, { force: true });
    throw error;
  }
}

/**
 * How `npm ci` starts in the check folder `dir`: as its other programs do (`spawn`), and with
 * npm's proxy and certificate settings, which it needs to reach the registry. npm's user config
 * is an empty file of the install's own, so the registry the module's `.npmrc` names gets none
 * of the credentials in this server user's `~/.npmrc`.
 */
async function installSpawn(dir: string, spawn: RunBuildSpawn): Promise<RunBuildSpawn> {
  const userconfig = path.join(dir, RUN_BUILD_NPM_CACHE, "user.npmrc");
  await fs.mkdir(path.dirname(userconfig), { recursive: true });
  await fs.writeFile(userconfig, "");
  const env: NodeJS.ProcessEnv = {
    ...runBuildEnv({ install: true }),
    npm_config_userconfig: userconfig,
  };
  if (spawn.env.npm_config_cache) env.npm_config_cache = spawn.env.npm_config_cache;
  return { ...spawn, env };
}

/** Runs a program in `cwd`, streaming its output to the log; a failure ends the stage. */
function program(
  ctx: DeployStageContext,
  cwd: string,
  command: string,
  args: readonly string[],
  spawn: RunBuildSpawn,
) {
  return logged(ctx, command, `${command} ${args.join(" ")}`, (onOutput) =>
    ctx.process.run(command, [...args], {
      cwd,
      signal: ctx.signal,
      onOutput,
      ...spawn,
    }),
  );
}

/**
 * Runs one step as the line `line` names it, streaming its output to the log; a failure ends
 * the stage, naming `command` when it could not be started.
 */
async function logged(
  ctx: DeployStageContext,
  command: string,
  line: string,
  run: (onOutput: (text: string) => void) => Promise<DeployProcessResult>,
) {
  checkStopped(ctx);
  ctx.log(`$ ${line}`);
  const out = lineWriter(ctx.log);
  const result = await run((text) => out.write(text));
  out.flush();
  if (result.error === "stopped" || ctx.signal.aborted) throw new DeployStopped();
  if (result.error === "not_found" || result.error === "not_started")
    throw new DeployStageFailure({ code: "command_missing", command });
  if (result.error === "timed_out")
    throw new DeployStageFailure({ code: "command_timed_out", command: line });
  if (result.code !== 0)
    throw new DeployStageFailure({
      code: "command_failed",
      command: line,
      exitCode: result.code,
      output: tailOf(result.tail),
    });
}

/**
 * What is never copied from an assembled module into the clone: `.lfsconfig` among it, since it
 * would tell the push's LFS upload where to send the clone's files.
 */
const NOT_COPIED = new Set([".git", "node_modules", RUN_BUILD_NPM_CACHE, ".lfsconfig"]);

/** Copies the assembled module over the clone's working tree (files the module lacks stay). */
async function syncModule(source: string, target: string): Promise<number> {
  let copied = 0;
  async function walk(from: string, to: string) {
    for (const entry of await fs.readdir(from, { withFileTypes: true })) {
      if (NOT_COPIED.has(entry.name)) continue;
      const src = path.join(from, entry.name);
      const dst = path.join(to, entry.name);
      if (entry.isDirectory()) {
        await fs.mkdir(dst, { recursive: true });
        await walk(src, dst);
      } else if (entry.isFile()) {
        await fs.copyFile(src, dst);
        copied++;
      }
    }
  }
  await walk(source, target);
  return copied;
}

/** The plain semver tags newer than `before`, oldest first. */
function newerTags(
  tags: readonly string[],
  before: string | null,
): Array<{ tag: string; version: string }> {
  const newer: Array<{ tag: string; version: string }> = [];
  for (const raw of tags) {
    const version = plainSemver(raw);
    if (version && (before === null || compareSemver(version, before) > 0))
      newer.push({ tag: raw.trim(), version });
  }
  return newer.sort((a, b) => compareSemver(a.version, b.version));
}

/** The files a module build may change in what it tags, and only in their "version". */
const VERSIONED_FILES = new Set(["package.json", "package-lock.json"]);

/** A package.json or package-lock.json without its own version; null when it is not JSON. */
function unversioned(text: string | null): string | null {
  if (text === null) return null;
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    delete json.version;
    const root = (json.packages as Record<string, Record<string, unknown>> | undefined)?.[""];
    if (root) delete root.version;
    return JSON.stringify(json);
  } catch {
    return null;
  }
}

/**
 * How a release tag holds a commit: `commit` when it is that commit or one made on top of
 * it; `content` when it has every file the commit has as the commit has it, package.json and
 * package-lock.json apart from their version (a build that squashes or rebases what it
 * releases).
 */
type TagHold = "commit" | "content";

/** How release tag `tag` holds `commit` (see `TagHold`); null when it does not hold it. */
async function tagHold(clone: Clone, tag: string, commit: string): Promise<TagHold | null> {
  if (await clone.tagHolds(tag, commit)) return "commit";
  for (const file of await clone.tagDiffers(tag, commit)) {
    if (!VERSIONED_FILES.has(file)) return null;
    const tagged = unversioned(await clone.fileAt({ tag }, file));
    if (tagged === null || tagged !== unversioned(await clone.fileAt({ commit }, file)))
      return null;
  }
  return "content";
}

/**
 * The release a module build made of `commit`: the oldest tag newer than `before` that holds it
 * (see `tagHold`), and how it does. Null when none does.
 */
async function releaseOf(
  clone: Clone,
  tags: readonly string[],
  before: string | null,
  commit: string,
): Promise<{ tag: string; version: string; hold: TagHold } | null> {
  for (const { tag, version } of newerTags(tags, before)) {
    const hold = await tagHold(clone, tag, commit);
    if (hold) return { tag, version, hold };
  }
  return null;
}

async function jenkinsCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw new DeployStageFailure({
      code: "jenkins_failed",
      status: error instanceof JenkinsError ? error.status : 0,
    });
  }
}

/** Whether a build has yet to finish. */
function going(status: JenkinsBuildStatus): boolean {
  return status.state === "queued" || status.state === "building";
}

/**
 * What a trigger does before starting its job. `last` is the stage's last start when this one
 * would start the same thing again (its wait did not finish, and nothing it starts from has
 * changed). When Jenkins has that start's build, numbered above its floor, queued or going, or
 * succeeded and `good` (absent: any success), it is followed instead of started again: the
 * answer carries that start's floor. Jenkins is read once more, RECHECK_MS later, when it has
 * that build neither queued nor listed. Otherwise a build of these parameters still queued or
 * going fails the stage, as a second would run beside it, and the newest build is the floor the
 * new one is looked for above.
 */
async function startOrFollow(
  ctx: DeployStageContext,
  job: string,
  match: Record<string, string>,
  last: { floor: number | null; good?: () => Promise<boolean> } | null,
): Promise<{ follow: boolean; floor: number | null }> {
  if (last) {
    const read = () => jenkinsCall(() => ctx.jenkins.status(job, match, { after: last.floor }));
    let status = await read();
    if (status.state === "unknown") {
      // Between leaving the queue and being listed, the build is neither: look once more
      // before starting a second.
      await ctx.clock.sleep(RECHECK_MS, ctx.signal);
      checkStopped(ctx);
      status = await read();
    }
    const finishedWell = status.state === "succeeded" && (!last.good || (await last.good()));
    if (going(status) || finishedWell) {
      ctx.log(
        `Jenkins has the build the last start began, ${status.state}${status.url ? ` (${status.url})` : ""}: following it rather than starting another.`,
      );
      return { follow: true, floor: last.floor };
    }
  }
  const newest = await jenkinsCall(() => ctx.jenkins.status(job, match));
  if (going(newest))
    throw new DeployStageFailure({ code: "build_in_flight", url: newest.url ?? null });
  return { follow: false, floor: newest.number ?? null };
}

const verifyModule: DeployStageDefinition = {
  id: "verify_module",
  async run(ctx) {
    // The module is where activities are authored, so what is in its working tree is work:
    // it is carried onto main as origin has it (never reset away), the newest assembled
    // module is copied over it, and all of it is committed on main before the checks run.
    const confiner = moduleConfiner(ctx);
    const clone = cloneOf(ctx, ctx.module.dir);
    const checked = await ctx.serial("module", async () => {
      // An npm cache in the clone is never the module's (earlier checks ran there).
      await fs.rm(path.join(ctx.module.dir, RUN_BUILD_NPM_CACHE), { recursive: true, force: true });
      try {
        await clone.fetch();
      } catch (error) {
        if (!(error instanceof CloneError)) throw error;
        // A new product's module starts locally; its repository has to exist before a deploy.
        if (repositoryMissing(error.result.stderr))
          throw new DeployStageFailure({
            code: "module_repository_missing",
            remote: await clone.origin(),
          });
        await clone.fetch();
      }
      await onMainCarryingWork(ctx, clone);
      if (ctx.module.source) {
        const copied = await syncModule(ctx.module.source, ctx.module.dir);
        ctx.log(`Copied ${copied} files from the newest assembled module.`);
      } else ctx.log("No assembled module: verifying the module as its repository holds it.");
      await clone.stage();
      const authored = await clone.commitStaged(
        identityOf(ctx),
        `Penguin Harness: ${ctx.productCode} as authored`,
      );
      ctx.log(
        authored
          ? `Committed the authored module on main: ${authored}.`
          : "Main already had everything authored.",
      );
      return authored ?? (await clone.commitOf(BASE_BRANCH));
    });
    ctx.metadata.moduleContentHash = ctx.module.contentHash ?? null;
    if (ctx.module.source && ctx.module.runId) ctx.metadata.moduleRunId = ctx.module.runId;
    await inCheckFolder(ctx, clone, checked, async (dir) => {
      const spawn = runBuildSpawn(dir, confiner);
      const install = await installSpawn(dir, spawn);
      for (const args of MODULE_VERIFY_COMMANDS)
        await program(ctx, dir, "npm", args, args[0] === "ci" ? install : spawn);
    });
  },
};

/**
 * Puts a clone on main as origin has it without losing what is in its working tree (see
 * `Clone.onBranchFromOrigin`): a main that has diverged from origin fails the stage, naming
 * git's reason, and a clone with no commit yet (a new module) keeps its work in place.
 */
async function onMainCarryingWork(ctx: DeployStageContext, clone: Clone): Promise<void> {
  const { workInPlace } = await clone.onBranchFromOrigin(BASE_BRANCH, { work: "carry" });
  if (workInPlace) ctx.log("No commit yet: the new module's work stays in place.");
}

/**
 * Writes `commit`'s package.json and lock into the clone with the package name, and the version
 * when one is given. Answers the version package.json has, and the files written, relative to
 * the clone.
 */
async function syncPackage(
  ctx: DeployStageContext,
  clone: Clone,
  commit: string,
): Promise<{ version: string | undefined; written: string[] }> {
  const name = modulePackageName(ctx.module.folder);
  const text = await clone.fileAt({ commit }, "package.json");
  if (text === null) throw new Error(`The module has no package.json in ${commit}.`);
  const pkg = JSON.parse(text) as Record<string, unknown>;
  pkg.name = name;
  if (ctx.moduleVersion) pkg.version = ctx.moduleVersion;
  await writeInClone(ctx.module.dir, "package.json", `${JSON.stringify(pkg, null, 2)}\n`);
  const written = ["package.json"];
  const lockText = await clone.fileAt({ commit }, "package-lock.json");
  if (lockText !== null) {
    written.push("package-lock.json");
    const lock = JSON.parse(lockText) as Record<string, unknown>;
    lock.name = name;
    if (ctx.moduleVersion) lock.version = ctx.moduleVersion;
    const root = (lock.packages as Record<string, Record<string, unknown>> | undefined)?.[""];
    if (root) {
      root.name = name;
      if (ctx.moduleVersion) root.version = ctx.moduleVersion;
    }
    await writeInClone(ctx.module.dir, "package-lock.json", `${JSON.stringify(lock, null, 2)}\n`);
  }
  return { version: typeof pkg.version === "string" ? pkg.version : undefined, written };
}

/** A log line naming at most PATHS_SHOWN of `paths`, and how many more there are. */
function someOf(paths: readonly string[]): string {
  const more = paths.length - PATHS_SHOWN;
  return `${paths.slice(0, PATHS_SHOWN).join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
}

/** The stylesheet a module's release compiles, when it has one, and what that makes. */
const STYLE_SOURCE = "res/style.scss";
const STYLE_OUTPUT = "res/style.css";

/**
 * Compiles the stylesheet in check folder `dir`, through `confiner` when there is one, and
 * answers what it made: the one file of the folder the release takes (`readOutput`).
 */
async function compileStyle(
  ctx: DeployStageContext,
  dir: string,
  confiner: SpawnConfiner | null,
): Promise<Buffer> {
  const line = `${SASS_PACKAGE} ${STYLE_SOURCE} ${STYLE_OUTPUT} --no-source-map`;
  await logged(ctx, "sass", line, (onOutput) =>
    ctx.styles({
      cwd: dir,
      from: STYLE_SOURCE,
      to: STYLE_OUTPUT,
      signal: ctx.signal,
      onOutput,
      runModule: true,
      ...runBuildSpawn(dir, confiner),
    }),
  );
  const made = await readOutput(dir, STYLE_OUTPUT);
  if (made === null)
    throw new DeployStageFailure({
      code: "command_failed",
      command: line,
      exitCode: 0,
      output: `The compile left no ${STYLE_OUTPUT}.`,
    });
  return made;
}

/**
 * What `file` in check folder `dir` holds, when it is a plain file of the folder's own: in a
 * folder that really is inside it, not a link (opened without following one where the system
 * can, looked at first where it cannot), and with no other name. Null otherwise.
 */
async function readOutput(dir: string, file: string): Promise<Buffer | null> {
  const output = path.join(dir, file);
  const [realDir, realFolder] = await Promise.all([
    fs.realpath(dir),
    fs.realpath(path.dirname(output)).catch(() => null),
  ]);
  if (realFolder === null || !inside(realDir, realFolder)) return null;
  if (!(await fs.lstat(output).catch(() => null))?.isFile()) return null;
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const handle = await fs.open(output, fsConstants.O_RDONLY | noFollow).catch(() => null);
  if (!handle) return null;
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1) return null;
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

const prepareDeploy: DeployStageDefinition = {
  id: "prepare_deploy",
  async run(ctx) {
    const branch = deployBranchName(ctx.module.folder);
    // From main's commit, the one verify_module committed and checked, carrying the working
    // tree onto the deploy branch. The files this stage writes are made from that commit's.
    // It runs once per verify (stageBlocker).
    const clone = cloneOf(ctx, ctx.module.dir);
    const { checked, style, version, written } = await ctx.serial("module", async () => {
      const commit = await clone.commitOf(BASE_BRANCH);
      // Refused before the branch is made, when the stylesheet cannot be compiled as it must be.
      const style =
        (await clone.fileAt({ commit }, STYLE_SOURCE)) !== null
          ? { confiner: moduleConfiner(ctx) }
          : null;
      await clone.branchFrom(branch, commit);
      return { checked: commit, style, ...(await syncPackage(ctx, clone, commit)) };
    });
    if (version) ctx.metadata.moduleVersion = version;
    if (style) {
      const css = await inCheckFolder(ctx, clone, checked, (dir) =>
        compileStyle(ctx, dir, style.confiner),
      );
      await writeInClone(ctx.module.dir, STYLE_OUTPUT, css);
      written.push(STYLE_OUTPUT);
    } else ctx.log(`No ${STYLE_SOURCE}: no stylesheet to compile.`);
    // Only what this stage wrote joins what verify_module committed and checked: a file saved
    // in the clone while the checks ran was never checked, so it stays out of the release.
    const { commit, left } = await ctx.serial("module", async () => {
      const staged: string[] = [];
      for (const file of written) if (await clone.changed(file)) staged.push(file);
      if (staged.length) await clone.stage(staged);
      const made = await clone.commitStaged(
        identityOf(ctx),
        `Prepare module deploy for ${ctx.productCode}`,
      );
      return { commit: made, left: await clone.changes() };
    });
    if (left.length)
      ctx.log(
        `Left out of the deploy commit, changed since verify_module checked the module: ${someOf(left)}.`,
      );
    if (!commit) {
      ctx.log("Nothing changed since the branch's last commit: nothing to commit.");
      return;
    }
    ctx.metadata.commit = commit;
  },
};

/**
 * The module build the last trigger started, when this trigger would start it again: the wait
 * after it did not finish, and the deploy branch at `commit` holds the same files it was started
 * for (verify and prepare run again commit the same content anew).
 */
async function lastModuleBuild(
  ctx: DeployStageContext,
  clone: Clone,
  commit: string,
): Promise<{ tag: string | null; floor: number | null; commit: string } | null> {
  const last = ctx.earlier.trigger_module_build;
  if (!last?.buildCommit || last.preBuildTag === undefined || ctx.earlier.await_module_build)
    return null;
  if (!(await clone.sameContent(last.buildCommit, commit))) return null;
  return { tag: last.preBuildTag, floor: last.preBuildNumber ?? null, commit: last.buildCommit };
}

const triggerModuleBuild: DeployStageDefinition = {
  id: "trigger_module_build",
  async run(ctx) {
    const branch = deployBranchName(ctx.module.folder);
    const job = ctx.settings.jobs.moduleBuild;
    const params = { Modules: moduleBuildLine(ctx.module.folder) };
    const clone = cloneOf(ctx, ctx.module.dir);
    const { tags, commit, last } = await ctx.serial("module", async () => {
      const fetched = await clone.fetchTags();
      const head = await clone.commitOf(branch);
      return { tags: fetched, commit: head, last: await lastModuleBuild(ctx, clone, head) };
    });
    const start = await startOrFollow(
      ctx,
      job,
      params,
      last && {
        floor: last.floor,
        // One that succeeded is followed only when it released what it was started for.
        good: () =>
          ctx.serial(
            "module",
            async () => (await releaseOf(clone, tags, last.tag, last.commit)) !== null,
          ),
      },
    );
    if (start.follow && last) {
      ctx.metadata.preBuildTag = last.tag;
      ctx.metadata.preBuildNumber = last.floor;
      ctx.metadata.buildCommit = last.commit;
      return;
    }
    ctx.metadata.preBuildTag = latestSemver(tags);
    ctx.log(`Newest release tag before the build: ${ctx.metadata.preBuildTag ?? "none"}.`);
    ctx.metadata.preBuildNumber = start.floor;
    ctx.metadata.buildCommit = commit;
    await ctx.serial("module", async () => {
      if (!(await clone.remoteHasBranch(BASE_BRANCH))) await clone.push(BASE_BRANCH);
      await clone.push(branch, { lease: true, track: true });
    });
    checkStopped(ctx);
    ctx.log(`Starting Jenkins job "${job}" with Modules=${params.Modules}.`);
    const { queueUrl } = await jenkinsCall(() => ctx.jenkins.trigger(job, params));
    if (queueUrl) ctx.log(`Queued: ${queueUrl}`);
  },
};

const awaitModuleBuild: DeployStageDefinition = {
  id: "await_module_build",
  async run(ctx) {
    // Run on its own, the stage waits on the build the trigger stage last started.
    const triggered =
      ctx.metadata.preBuildTag !== undefined ? ctx.metadata : ctx.earlier.trigger_module_build;
    if (!triggered || triggered.preBuildTag === undefined)
      throw new DeployStageFailure({ code: "missing_input", stage: "trigger_module_build" });
    const before = triggered.preBuildTag;
    const after = triggered.preBuildNumber ?? null;
    const clone = cloneOf(ctx, ctx.module.dir);
    // A start recorded before its commit was noted pushed the deploy branch as it still is.
    const commit =
      triggered.buildCommit ?? (await clone.commitOf(deployBranchName(ctx.module.folder)));
    ctx.metadata.preBuildTag = before;
    ctx.metadata.preBuildNumber = after;
    ctx.metadata.buildCommit = commit;
    const job = ctx.settings.jobs.moduleBuild;
    const params = { Modules: moduleBuildLine(ctx.module.folder) };
    const minutes = ctx.settings.timeouts.buildMinutes;
    const deadline = ctx.clock.now() + minutes * 60_000;
    let last: JenkinsBuildStatus["state"] | null = null;
    for (;;) {
      checkStopped(ctx);
      const status = await jenkinsCall(() => ctx.jenkins.status(job, params, { after }));
      if (status.url && status.url !== ctx.metadata.moduleBuildUrl) {
        ctx.metadata.moduleBuildUrl = status.url;
        ctx.log(`Build: ${status.url}`);
      }
      if (status.state !== last) {
        ctx.log(`Jenkins: ${status.state}${status.number ? ` (#${status.number})` : ""}.`);
        last = status.state;
      }
      if (status.state === "failed")
        throw new DeployStageFailure({
          code: "build_failed",
          result: status.result ?? "FAILURE",
          url: status.url ?? null,
        });
      if (status.state === "succeeded") {
        // Only this build, once it succeeded, releases the module, and only as a tag that
        // holds what it built: a tag a leftover or a manual build made is never taken for it.
        const { tags, release } = await ctx.serial("module", async () => {
          const fetched = await clone.fetchTags();
          return { tags: fetched, release: await releaseOf(clone, fetched, before, commit) };
        });
        if (release) {
          ctx.metadata.resolvedModuleVersion = release.version;
          ctx.log(
            release.hold === "commit"
              ? `Released as ${release.version}: tag ${release.tag} holds ${commit}.`
              : `Released as ${release.version}: tag ${release.tag} does not hold ${commit} but has its files as it has them (package.json and package-lock.json apart from their version).`,
          );
          return;
        }
        const newest = newerTags(tags, before).at(-1);
        throw new DeployStageFailure(
          newest
            ? { code: "tag_without_commit", tag: newest.tag, commit }
            : { code: "no_newer_tag", before, after: latestSemver(tags) },
        );
      }
      if (ctx.clock.now() >= deadline)
        throw new DeployStageFailure({ code: "build_timed_out", minutes });
      await ctx.clock.sleep(BUILD_POLL_MS, ctx.signal);
    }
  },
};

/** How often the activity deploy is looked at while waiting for it. */
export const DEPLOY_POLL_MS = 15_000;

function qaOf(ctx: DeployStageContext): DeployQaContext {
  if (!ctx.qa) throw new Error("This run has no activity-data or media clone to work in.");
  return ctx.qa;
}

/**
 * The released module version the QA stages pin: this run's, else the one the last release (or
 * the last export) recorded. A QA stage never guesses one.
 */
function releasedVersion(ctx: DeployStageContext): string {
  const version =
    ctx.metadata.resolvedModuleVersion ??
    ctx.earlier.export_activity_data?.resolvedModuleVersion ??
    ctx.earlier.await_module_build?.resolvedModuleVersion;
  if (!version)
    throw new DeployStageFailure({ code: "missing_input", stage: "await_module_build" });
  ctx.metadata.resolvedModuleVersion = version;
  return version;
}

/** The exported data's check, reading the activity-data clone. */
async function preflightOf(ctx: DeployStageContext, version: string) {
  const qa = qaOf(ctx);
  return runPreflight({
    productCode: ctx.productCode,
    expectedModule: mainModule(ctx.module.folder, version),
    mediaBase: ctx.settings.repos.mediaPublicBase,
    read: async (relative) => {
      const file = withinRoot(qa.activityData.dir, relative);
      return file ? fs.readFile(file, "utf8").catch(() => null) : null;
    },
  });
}

const exportActivityData: DeployStageDefinition = {
  id: "export_activity_data",
  async run(ctx) {
    const qa = qaOf(ctx);
    const version = releasedVersion(ctx);
    const dir = qa.activityData.dir;
    // The clone is the deploy's own: it is put back as origin has it, and nothing else kept.
    await cloneOf(ctx, dir).onBranchFromOrigin(activityDataBranchName(ctx.productCode), {
      work: "discard",
      from: BASE_BRANCH,
    });
    const snapshot = await qa.snapshot();
    checkStopped(ctx);
    let files;
    try {
      files = exportFiles({
        productCode: ctx.productCode,
        title: snapshot.title,
        layout: snapshot.layout,
        theme: snapshot.theme,
        moduleFolder: ctx.module.folder,
        version,
        mediaBase: ctx.settings.repos.mediaPublicBase,
        refs: snapshot.refs,
      });
    } catch (error) {
      if (error instanceof ExportLayoutError) ctx.log(error.message);
      throw error;
    }
    for (const file of files) {
      const target = withinRoot(dir, file.path);
      if (!target) throw new Error(`An exported path left the clone: ${file.path}`);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.content);
      ctx.log(`Wrote ${file.path}`);
    }
    const refs = deployedRefs(snapshot.refs);
    ctx.metadata.deployedRefNums = refs.map((ref) => ref.refNum);
    ctx.metadata.exportedFiles = files.map((file) => file.path);
    ctx.metadata.exportedRevision = snapshot.contentRevision;
    ctx.metadata.exportedProductRevision = snapshot.productRevision;
    ctx.log(
      `Exported ${refs.length} ref${refs.length === 1 ? "" : "s"} for ${mainModule(ctx.module.folder, version)}.`,
    );
  },
};

const verifyActivityData: DeployStageDefinition = {
  id: "verify_activity_data",
  async run(ctx) {
    const version = releasedVersion(ctx);
    const report = await preflightOf(ctx, version);
    const { errors, warnings, counts } = report;
    ctx.metadata.preflight = { errors, warnings, counts };
    ctx.log(
      `Checked ${report.counts.templates} template, ${report.counts.configurations} configurations, ${report.counts.assessments} assessments and ${report.counts.media} media files.`,
    );
    for (const warning of report.warnings) ctx.log(`Warning: ${JSON.stringify(warning)}`);
    for (const error of report.errors) ctx.log(`Error: ${JSON.stringify(error)}`);
    if (report.errors.length)
      throw new DeployStageFailure({ code: "preflight_failed", errors: report.errors.length });
  },
};

const verifyMediaAssets: DeployStageDefinition = {
  id: "verify_media_assets",
  async run(ctx) {
    const qa = qaOf(ctx);
    const version = releasedVersion(ctx);
    const report = await preflightOf(ctx, version);
    if (report.errors.length)
      throw new DeployStageFailure({ code: "preflight_failed", errors: report.errors.length });
    ctx.metadata.mediaChecked = report.media.length;
    const cwd = qa.media.dir;
    // Authored media (accepted takes, uploads, candidates) is in the clone's working tree:
    // main is brought up to origin around it, and only what the data names is published.
    const clone = cloneOf(ctx, cwd);
    await ctx.serial("media", async () => {
      await clone.fetch();
      await onMainCarryingWork(ctx, clone);
      const result = await syncMedia(
        { dir: cwd, references: report.media },
        { clone, log: ctx.log },
      );
      for (const missing of result.missing.slice(0, PATHS_SHOWN)) ctx.log(`Missing: ${missing}`);
      if (result.missing.length)
        throw new DeployStageFailure({
          code: "media_missing",
          paths: result.missing.slice(0, PATHS_SHOWN),
          count: result.missing.length,
        });
      ctx.metadata.mediaCopied = result.copied.slice(0, PATHS_SHOWN);
      ctx.metadata.mediaCopiedCount = result.copied.length;
      if (!result.copied.length) {
        ctx.log("The media repository already has every file: nothing to publish.");
        return;
      }
      // --sparse: an authored file may sit in a folder the partial clone has not checked out.
      await clone.stage(result.copied, { sparse: true });
      const commit = await clone.commitStaged(
        identityOf(ctx),
        `Publish media for ${ctx.productCode}`,
      );
      if (!commit) return;
      ctx.metadata.mediaCommit = commit;
      await clone.push(BASE_BRANCH);
    });
  },
};

const publishActivityData: DeployStageDefinition = {
  id: "publish_activity_data",
  async run(ctx) {
    const qa = qaOf(ctx);
    const version = releasedVersion(ctx);
    const files =
      ctx.metadata.exportedFiles ?? ctx.earlier.export_activity_data?.exportedFiles ?? null;
    if (!files?.length)
      throw new DeployStageFailure({ code: "missing_input", stage: "export_activity_data" });
    const clone = cloneOf(ctx, qa.activityData.dir);
    const branch = activityDataBranchName(ctx.productCode);
    await clone.stage(files);
    const commit = await clone.commitStaged(
      identityOf(ctx),
      `Deploy activity data for ${ctx.productCode} (${mainModule(ctx.module.folder, version)})`,
    );
    if (commit) ctx.metadata.activityDataCommit = commit;
    else ctx.log("The activity data had not changed: nothing to commit.");
    await clone.push(branch, { track: true });
  },
};

/** The parameters the activity deploy job is started with, as the job takes them. */
export function activityDeployParams(
  productCode: string,
  target: DeployJobTarget,
): Record<string, string> {
  return {
    branch: activityDataBranchName(productCode),
    framework_version: target.frameworkVersion,
    tier: target.tier,
    deploy_environment: target.environment,
    add_activities_to_catalog: "false",
    template_names: productCode,
  };
}

/** The parameters a started activity deploy is recognised by. */
function activityDeployMatch(params: Record<string, string>): Record<string, string> {
  return {
    branch: params.branch!,
    tier: params.tier!,
    deploy_environment: params.deploy_environment!,
    template_names: params.template_names!,
  };
}

/** Where the deployed activity opens on QA. */
export function qaActivityUrl(
  base: string,
  productCode: string,
  refNum: number,
  frameworkVersion: string,
): string {
  const query = new URLSearchParams({
    productCode,
    refNum: String(refNum),
    frameworkVersion,
  });
  return `${base}?${query.toString()}`;
}

const triggerActivityDeploy: DeployStageDefinition = {
  id: "trigger_activity_deploy",
  async run(ctx) {
    const qa = qaOf(ctx);
    const job = ctx.settings.jobs.activityDeploy;
    const params = activityDeployParams(ctx.productCode, qa.target);
    // Run again after its wait did not finish, with no new activity data or media published
    // since and the same framework version, the deploy deploys what the last one did.
    const last = ctx.earlier.trigger_activity_deploy;
    const repeat =
      last?.preDeployNumber !== undefined &&
      !ctx.earlier.await_activity_deploy &&
      last.qaFrameworkVersion === qa.target.frameworkVersion &&
      ctx.metadata.activityDataCommit === undefined &&
      ctx.metadata.mediaCommit === undefined;
    const start = await startOrFollow(
      ctx,
      job,
      activityDeployMatch(params),
      repeat ? { floor: last.preDeployNumber ?? null } : null,
    );
    ctx.metadata.preDeployNumber = start.floor;
    ctx.metadata.qaFrameworkVersion = qa.target.frameworkVersion;
    ctx.metadata.qaActivityUrl = qaActivityUrl(
      qa.target.activityBaseUrl,
      ctx.productCode,
      qa.refNum,
      qa.target.frameworkVersion,
    );
    if (start.follow) return;
    checkStopped(ctx);
    ctx.log(`Starting Jenkins job "${job}" with ${new URLSearchParams(params).toString()}.`);
    const { queueUrl } = await jenkinsCall(() => ctx.jenkins.trigger(job, params));
    if (queueUrl) ctx.log(`Queued: ${queueUrl}`);
  },
};

/**
 * Follows a started activity deploy every 15 seconds until it succeeds, fails, or the
 * configured minutes pass. `onUrl` gets the build's page once Jenkins has one. Returns the
 * number of the build that succeeded, or null when Jenkins gave none.
 */
async function followActivityDeploy(
  ctx: DeployStageContext,
  options: {
    match: Record<string, string>;
    after: number | null;
    onUrl(url: string): void;
    /** Named in a timeout; QA's timeouts name none, as they always have. */
    target?: DeployTarget;
  },
): Promise<number | null> {
  const job = ctx.settings.jobs.activityDeploy;
  const minutes = ctx.settings.timeouts.deployMinutes;
  const deadline = ctx.clock.now() + minutes * 60_000;
  let last: JenkinsBuildStatus["state"] | null = null;
  let url: string | null = null;
  for (;;) {
    checkStopped(ctx);
    const status = await jenkinsCall(() =>
      ctx.jenkins.status(job, options.match, { after: options.after }),
    );
    if (status.url && status.url !== url) {
      url = status.url;
      options.onUrl(status.url);
      ctx.log(`Deploy: ${status.url}`);
    }
    if (status.state !== last) {
      ctx.log(`Jenkins: ${status.state}${status.number ? ` (#${status.number})` : ""}.`);
      last = status.state;
    }
    if (status.state === "failed")
      throw new DeployStageFailure({
        code: "build_failed",
        result: status.result ?? "FAILURE",
        url: status.url ?? null,
      });
    if (status.state === "succeeded") return status.number ?? null;
    if (ctx.clock.now() >= deadline)
      throw new DeployStageFailure({
        code: "deploy_timed_out",
        minutes,
        ...(options.target ? { target: options.target } : {}),
      });
    await ctx.clock.sleep(DEPLOY_POLL_MS, ctx.signal);
  }
}

/** Whether a finished deploy stage followed the build an earlier run of it already recorded. */
function sameBuild(recorded: number | null | undefined, found: number | null): boolean {
  return typeof recorded === "number" && recorded === found;
}

const awaitActivityDeploy: DeployStageDefinition = {
  id: "await_activity_deploy",
  async run(ctx) {
    const qa = qaOf(ctx);
    // Run on its own, the stage waits on the deploy the trigger stage last started.
    const triggered =
      ctx.metadata.preDeployNumber !== undefined
        ? ctx.metadata
        : ctx.earlier.trigger_activity_deploy;
    if (!triggered || triggered.preDeployNumber === undefined)
      throw new DeployStageFailure({ code: "missing_input", stage: "trigger_activity_deploy" });
    const after = triggered.preDeployNumber ?? null;
    ctx.metadata.preDeployNumber = after;
    ctx.metadata.qaFrameworkVersion = triggered.qaFrameworkVersion ?? qa.target.frameworkVersion;
    ctx.metadata.qaActivityUrl =
      triggered.qaActivityUrl ??
      qaActivityUrl(
        qa.target.activityBaseUrl,
        ctx.productCode,
        qa.refNum,
        ctx.metadata.qaFrameworkVersion,
      );
    const number = await followActivityDeploy(ctx, {
      match: activityDeployMatch(activityDeployParams(ctx.productCode, qa.target)),
      after,
      onUrl: (url) => {
        ctx.metadata.activityDeployUrl = url;
      },
    });
    const previous = ctx.earlier.await_activity_deploy;
    ctx.metadata.activityDeployNumber = number;
    if (sameBuild(previous?.activityDeployNumber, number) && previous?.qaDeployedAt) {
      // Run again on its own, the stage found the build it had already seen finish.
      ctx.metadata.qaDeployedAt = previous.qaDeployedAt;
      ctx.metadata.alreadyRecorded = true;
    } else ctx.metadata.qaDeployedAt = new Date(ctx.clock.now()).toISOString();
    const revision =
      ctx.metadata.exportedRevision ?? ctx.earlier.export_activity_data?.exportedRevision;
    if (revision) ctx.metadata.contentRevision = revision;
    const productRevision =
      ctx.metadata.exportedProductRevision ??
      ctx.earlier.export_activity_data?.exportedProductRevision;
    if (productRevision) ctx.metadata.productRevision = productRevision;
    // The build this run verified, or with the release left out, the one verified before it.
    const verified =
      ctx.metadata.moduleContentHash !== undefined ? ctx.metadata : ctx.earlier.verify_module;
    if (verified?.moduleRunId) ctx.metadata.moduleRunId = verified.moduleRunId;
    ctx.log(`On QA: ${ctx.metadata.qaActivityUrl}`);
  },
};

function prodOf(ctx: DeployStageContext): DeployProdContext {
  if (!ctx.prod) throw new Error("This run has no PROD settings to deploy with.");
  return ctx.prod;
}

const triggerProductionDeploy: DeployStageDefinition = {
  id: "trigger_production_deploy",
  async run(ctx) {
    const prod = prodOf(ctx);
    // PROD gets what QA has: the branch QA's deploy published, at the revision QA recorded.
    const qa = ctx.earlier.await_activity_deploy;
    if (!qa)
      throw new DeployStageFailure({ code: "missing_input", stage: "await_activity_deploy" });
    if (qa.contentRevision) ctx.metadata.contentRevision = qa.contentRevision;
    if (qa.resolvedModuleVersion) ctx.metadata.resolvedModuleVersion = qa.resolvedModuleVersion;
    if (qa.moduleRunId) ctx.metadata.moduleRunId = qa.moduleRunId;
    const job = ctx.settings.jobs.activityDeploy;
    const params = activityDeployParams(ctx.productCode, prod.target);
    // Run again after its wait did not finish, with the same framework version, the deploy
    // deploys what the last one did: a QA stage run since would have set this one back.
    const last = ctx.earlier.trigger_production_deploy;
    const repeat =
      last?.preProductionDeployNumber !== undefined &&
      !ctx.earlier.await_production_deploy &&
      last.prodFrameworkVersion === prod.target.frameworkVersion;
    const start = await startOrFollow(
      ctx,
      job,
      activityDeployMatch(params),
      repeat ? { floor: last.preProductionDeployNumber ?? null } : null,
    );
    ctx.metadata.preProductionDeployNumber = start.floor;
    ctx.metadata.prodFrameworkVersion = prod.target.frameworkVersion;
    if (start.follow) return;
    checkStopped(ctx);
    ctx.log(
      `Starting Jenkins job "${job}" on PROD with ${new URLSearchParams(params).toString()}.`,
    );
    const { queueUrl } = await jenkinsCall(() => ctx.jenkins.trigger(job, params));
    if (queueUrl) ctx.log(`Queued: ${queueUrl}`);
  },
};

const awaitProductionDeploy: DeployStageDefinition = {
  id: "await_production_deploy",
  async run(ctx) {
    const prod = prodOf(ctx);
    // Run on its own, the stage waits on the deploy the trigger stage last started.
    const triggered =
      ctx.metadata.preProductionDeployNumber !== undefined
        ? ctx.metadata
        : ctx.earlier.trigger_production_deploy;
    if (!triggered || triggered.preProductionDeployNumber === undefined)
      throw new DeployStageFailure({ code: "missing_input", stage: "trigger_production_deploy" });
    ctx.metadata.preProductionDeployNumber = triggered.preProductionDeployNumber ?? null;
    ctx.metadata.prodFrameworkVersion =
      triggered.prodFrameworkVersion ?? prod.target.frameworkVersion;
    if (triggered.contentRevision) ctx.metadata.contentRevision = triggered.contentRevision;
    if (triggered.resolvedModuleVersion)
      ctx.metadata.resolvedModuleVersion = triggered.resolvedModuleVersion;
    if (triggered.moduleRunId) ctx.metadata.moduleRunId = triggered.moduleRunId;
    const number = await followActivityDeploy(ctx, {
      match: activityDeployMatch(activityDeployParams(ctx.productCode, prod.target)),
      after: ctx.metadata.preProductionDeployNumber,
      onUrl: (url) => {
        ctx.metadata.productionDeployUrl = url;
      },
      target: "prod",
    });
    const previous = ctx.earlier.await_production_deploy;
    ctx.metadata.productionDeployNumber = number;
    if (sameBuild(previous?.productionDeployNumber, number) && previous?.prodDeployedAt) {
      // Run again on its own, the stage found the build it had already seen finish.
      ctx.metadata.prodDeployedAt = previous.prodDeployedAt;
      ctx.metadata.alreadyRecorded = true;
    } else ctx.metadata.prodDeployedAt = new Date(ctx.clock.now()).toISOString();
    ctx.log("On PROD.");
  },
};

export const DEPLOY_STAGE_DEFINITIONS: Record<DeployStage, DeployStageDefinition> = {
  verify_module: speakingGit(verifyModule),
  prepare_deploy: speakingGit(prepareDeploy),
  trigger_module_build: speakingGit(triggerModuleBuild),
  await_module_build: speakingGit(awaitModuleBuild),
  export_activity_data: speakingGit(exportActivityData),
  verify_activity_data: verifyActivityData,
  verify_media_assets: speakingGit(verifyMediaAssets),
  publish_activity_data: speakingGit(publishActivityData),
  trigger_activity_deploy: triggerActivityDeploy,
  await_activity_deploy: awaitActivityDeploy,
  trigger_production_deploy: triggerProductionDeploy,
  await_production_deploy: awaitProductionDeploy,
};

/** The stages a selection runs, in order (a QA deploy's before any release is left out). */
export function stagesFor(selection: DeployStageSelection): DeployStage[] {
  if (selection === "release") return [...DEPLOY_RELEASE_STAGES];
  if (selection === "qa") return [...DEPLOY_STAGES];
  if (selection === "prod") return [...DEPLOY_PROD_STAGES];
  return [selection];
}

export function isStageSelection(value: unknown): value is DeployStageSelection {
  return (
    value === "release" ||
    value === "qa" ||
    value === "prod" ||
    (typeof value === "string" && (DEPLOY_ALL_STAGES as readonly string[]).includes(value))
  );
}

/** Whether a selection deploys to PROD: the PROD deploy, or one of its stages on its own. */
export function isProdSelection(selection: DeployStageSelection): boolean {
  return selection === "prod" || (DEPLOY_PROD_STAGES as readonly string[]).includes(selection);
}

/**
 * Whether the module's release is current, so a QA deploy can leave it out: every release
 * stage is done since the last verify, and verify checked the same assembled module (by its
 * content hash). Without an assembled module there is nothing to compare, so the release runs.
 */
export function releaseCurrent(
  stored: Partial<Record<DeployStage, { status: DeployStageStatus; metadata: DeployRunMetadata }>>,
  contentHash: string | null,
): boolean {
  if (!contentHash) return false;
  if (!DEPLOY_RELEASE_STAGES.every((stage) => stored[stage]?.status === "done")) return false;
  return (
    stored.verify_module?.metadata.moduleContentHash === contentHash &&
    Boolean(stored.await_module_build?.metadata.resolvedModuleVersion)
  );
}

/** The stages a QA deploy runs: all ten, or the six after the release when it is current. */
export function qaStages(releaseIsCurrent: boolean): DeployStage[] {
  return releaseIsCurrent ? [...DEPLOY_QA_STAGES] : [...DEPLOY_STAGES];
}

/**
 * Readiness problems every stage tolerates in the clones. The module and media clones hold
 * authored work, which the stages carry and commit; the activity-data clone is this server's
 * own, and export puts it back as origin has it. A release leaves the module clone on a
 * branch whose upstream is not there yet; an export that failed half way leaves the
 * activity-data clone with changes or commits not yet pushed.
 */
function tolerated(problem: DeployProblem): boolean {
  if (!("repo" in problem)) return false;
  if (problem.code === "clone_dirty" || problem.code === "clone_ahead") return true;
  if (problem.code !== "clone_unknown") return false;
  return problem.repo === "module" || problem.what === "status" || problem.what === "upstream";
}

/** The readiness problems that keep a stage from starting. */
export function startProblems(context: DeployContext): DeployProblem[] {
  return context.problems.filter((problem) => !tolerated(problem));
}

/**
 * Stages that work on what the stage before them left in the clone's working tree, so they run
 * once per run of that stage: running one again needs the stage before it run again first.
 */
const ONCE_PER_PREVIOUS: ReadonlySet<DeployStage> = new Set<DeployStage>(["prepare_deploy"]);

function blockerOf(problem: DeployProblem): DeployBlocker {
  if (problem.code === "settings_missing")
    return { code: "settings_missing", field: problem.field };
  if (problem.code === "clone_missing") return { code: "clone_missing", repo: problem.repo };
  if (problem.code === "clone_dirty") return { code: "clone_dirty", repo: problem.repo };
  return { code: "not_ready", problem };
}

/**
 * Why `stage` cannot run now, or null when it can: a run in progress, then the readiness
 * problems it does not tolerate, then the stage before it not done since it was last run
 * (starting a stage sets every stage after it back to pending), and for prepare_deploy, a run
 * of its own since verify_module last ran.
 */
export function stageBlocker(
  stage: DeployStage,
  context: DeployContext,
  statuses: Partial<Record<DeployStage, DeployStageStatus>>,
  runActive: boolean,
): DeployBlocker | null {
  if (runActive) return { code: "run_active" };
  const problem = startProblems(context)[0];
  if (problem) return blockerOf(problem);
  const index = DEPLOY_ALL_STAGES.indexOf(stage);
  if (index > 0) {
    const previous = DEPLOY_ALL_STAGES[index - 1]!;
    if (statuses[previous] !== "done") return { code: "previous_stage", stage: previous };
    if (ONCE_PER_PREVIOUS.has(stage) && (statuses[stage] ?? "pending") !== "pending")
      return { code: "previous_rerun", stage: previous };
  }
  return null;
}

/** A stage's stored state, as far as the PROD gate reads it. */
export interface GateStage {
  status: DeployStageStatus;
  finishedAt: string | null;
  metadata: DeployRunMetadata;
}

/**
 * Whether QA has the product as it is now, so PROD may get it: QA's deploy is done, finished
 * after the activity data was last published and its deploy last started, and recorded the
 * revision of every exported ref that the product still has — a sibling's edit counts too.
 */
export function qaCurrent(
  stored: Partial<Record<DeployStage, GateStage>>,
  currentProductRevision: string,
): boolean {
  const qa = stored.await_activity_deploy;
  if (qa?.status !== "done" || !qa.finishedAt) return false;
  const finished = Date.parse(qa.finishedAt);
  for (const stage of ["publish_activity_data", "trigger_activity_deploy"] as const) {
    const earlier = stored[stage];
    if (earlier?.status !== "done" || !earlier.finishedAt) return false;
    if (Date.parse(earlier.finishedAt) > finished) return false;
  }
  return (
    Boolean(qa.metadata.productRevision) && qa.metadata.productRevision === currentProductRevision
  );
}

/**
 * Why a PROD stage cannot run now, or null when it can: what keeps any stage from starting
 * (a run in progress, the readiness problems, the stage before it not done), then an empty
 * PROD setting, then, for the trigger, a QA deploy that is not of the activity as it is now.
 */
export function prodStageBlocker(
  stage: DeployStage,
  context: DeployContext,
  stored: Partial<Record<DeployStage, GateStage>>,
  runActive: boolean,
  facts: { currentProductRevision: string; missingSettings: readonly string[] },
): DeployBlocker | null {
  const statuses: Partial<Record<DeployStage, DeployStageStatus>> = {};
  for (const [key, value] of Object.entries(stored))
    if (value) statuses[key as DeployStage] = value.status;
  const base = stageBlocker(stage, context, statuses, runActive);
  if (base) return base;
  const field = facts.missingSettings[0];
  if (field) return { code: "settings_missing", field };
  if (stage === "trigger_production_deploy" && !qaCurrent(stored, facts.currentProductRevision))
    return { code: "qa_outdated" };
  return null;
}
