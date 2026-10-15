/**
 * Building a module: a run workspace's own build, a checkout module's build into Penguin's
 * output, the player bundle, and the stylesheet compile every one of them and a deploy's
 * prepare stage share.
 *
 * A stylesheet is compiled with the Sass the WAF build pins (`SASS_PACKAGE`), by its
 * command line, as a deploy always compiled it: what the preview shows is what a release
 * ships. That Sass is installed once under Penguin's root on first use and run from there
 * with this process's Node, so after the first compile nothing asks a registry again.
 *
 * A run workspace's build is its agent's code, so it is built as the agent's own commands ran:
 * confined to the module while activity agents are confined (`sandbox-build-runner`), and an
 * install of the Sass it waits for takes nothing from the module. A checkout module's build
 * runs the checkout's code, and is not confined.
 *
 * Tests replace `ModuleBuilder` with builds over a fake compiler; nothing here is reached by a
 * test that installs a package.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { SpawnConfiner } from "@prismshadow/penguin-core";
import { Component, Interface, Use } from "@prismshadow/penguin-core/kernel";
import type { Config } from "../hmr/capabilities.js";
import type { Settings } from "../mechanisms/settings.js";
import { Sandbox, SandboxModule } from "../sandbox/service.js";
import {
  spawnDeployProcess,
  type DeployProcess,
  type DeployProcessResult,
} from "./deploy-process.js";
import { confinedArgv, type ProgramConfiner } from "./run-program.js";
import {
  runBuildEnv,
  spawnModuleBuild,
  spawnNodeScript,
  type BuildOutcome,
} from "./sandbox-build-runner.js";
import { spawnCheckoutBuild, type CheckoutBuildJob } from "./sandbox-checkout-build.js";
import { PLAYER_BUILD_SCRIPT, PLAYER_SOURCE } from "./sandbox-player.js";
import { MODULE_PACKAGES } from "./waf-module.js";

const SASS_VERSION = "1.54.0";

/** The Sass a module's stylesheet is compiled with, pinned as the WAF build pins it. */
export const SASS_PACKAGE = `sass@${SASS_VERSION}`;

/** How long installing the pinned Sass may take on a slow link. */
const SASS_INSTALL_TIMEOUT_MS = 5 * 60 * 1000;

/** One stylesheet to compile: `from` to `to`, both relative to `cwd` or absolute. */
export interface StyleJob {
  cwd: string;
  from: string;
  to: string;
  /** Aborting it stops the compile. */
  signal?: AbortSignal;
  /** The compiler's output, as it arrives. */
  onOutput?: (text: string) => void;
  /** The compiler's whole environment; absent, this process's. */
  env?: NodeJS.ProcessEnv;
  /** The compiler runs confined (see `ProgramSpec.confine`). */
  confine?: ProgramConfiner;
  /**
   * `cwd` is a run's module, written by its agent. An install of the pinned Sass this compile
   * waits for then reads none of its files: npm gets the `.npmrc` every run's module is
   * scaffolded with, and only what it needs of this process's environment.
   */
  runModule?: boolean;
}

/** How a compile went, as a deploy's programs report it. */
export type StyleResult = DeployProcessResult;

export type StyleCompiler = (job: StyleJob) => Promise<StyleResult>;

/** What a player build needs: the framework it bundles, and where the bundle goes. */
export interface PlayerBuildJob {
  frameworkRoot: string;
  outputRoot: string;
}

/** Every build a preview and a deploy run. None of them throws: a failure is an outcome. */
export abstract class ModuleBuilder extends Interface<{
  /** Compiles one stylesheet with the pinned Sass. */
  compileStyle(job: StyleJob): Promise<StyleResult>;
  /**
   * A run workspace's module, built in place by its own script, its stylesheet first, with
   * none of this server's environment and, while activity agents are confined, writable only
   * in the module.
   */
  buildRun(workspace: string): Promise<BuildOutcome>;
  /** A checkout module, built into Penguin's output without writing to the checkout. */
  buildCheckout(job: CheckoutBuildJob): Promise<BuildOutcome>;
  /** The player bundle, built from the checkout's framework. */
  buildPlayer(job: PlayerBuildJob): Promise<BuildOutcome>;
}>() {}

/**
 * The builds, over one stylesheet compiler (the real one, or a test's) and the sandbox a run's
 * build is confined in: `runConfiner` answers it when a build starts, null while activity
 * agents are not confined.
 */
export function moduleBuilds(
  compileStyle: StyleCompiler,
  runConfiner: () => SpawnConfiner | null = () => null,
): ModuleBuilder {
  return {
    compileStyle,
    buildRun: (workspace) => spawnModuleBuild(workspace, { compileStyle, confiner: runConfiner() }),
    buildCheckout: (job) => spawnCheckoutBuild(job, { compileStyle }),
    buildPlayer: (job) =>
      spawnNodeScript(PLAYER_BUILD_SCRIPT, {
        cwd: job.frameworkRoot,
        env: {
          PENGUIN_PLAYER_BUILD: JSON.stringify({
            frameworkRoot: job.frameworkRoot,
            outputRoot: job.outputRoot,
            source: PLAYER_SOURCE,
          }),
        },
      }),
  };
}

/** Where the pinned Sass is installed under Penguin's root. */
export function sassHome(penguinRoot: string): string {
  return path.join(penguinRoot, "tools", `sass-${SASS_VERSION}`);
}

/** The command line script of a complete install of the pinned Sass, or null. */
async function installedSass(home: string): Promise<string | null> {
  const sass = path.join(home, "node_modules", "sass");
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(sass, "package.json"), "utf8")) as {
      version?: unknown;
    };
    if (pkg.version !== SASS_VERSION) return null;
  } catch {
    return null;
  }
  const cli = path.join(sass, "sass.js");
  return (await fs.stat(cli).catch(() => null))?.isFile() ? cli : null;
}

/**
 * The pinned Sass, installed on first use and reused after.
 *
 * Installed into a folder of its own beside the final one and renamed into place, so an
 * install cut short is never mistaken for a complete one; concurrent callers share one
 * install, and a failed one is tried again by the next caller.
 *
 * The install reaches the registry the module's own `.npmrc` names, as `npx` run in the
 * module did: a server that can only reach the module's registry still installs. The copy is
 * npm's project config during the install and is removed before the folder is kept, since it
 * may hold the registry's credentials; without one, npm's user config applies.
 *
 * A run's module is its agent's work, and its `.npmrc` could name a registry of the agent's
 * that serves its own `sass`, kept here for every later compile, or expand this server's
 * variables into credentials sent there. So an install for one (`StyleJob.runModule`) uses the
 * `.npmrc` the module was scaffolded with and starts with none of this server's secrets.
 */
export class PinnedSass {
  private installing: Promise<string> | null = null;

  constructor(
    private readonly home: string,
    private readonly run: DeployProcess["run"] = spawnDeployProcess.run,
  ) {}

  /**
   * The command line script, installing the pinned Sass first when it is not there, with the
   * npm settings of the module `job` compiles in when it has any (see the class).
   */
  cli(job?: Pick<StyleJob, "cwd" | "runModule">): Promise<string> {
    this.installing ??= this.install(job).catch((error: unknown) => {
      this.installing = null;
      throw error;
    });
    return this.installing;
  }

  private async install(job?: Pick<StyleJob, "cwd" | "runModule">): Promise<string> {
    const ready = await installedSass(this.home);
    if (ready) return ready;
    const staging = `${this.home}.${process.pid}.${Date.now()}.partial`;
    await fs.mkdir(staging, { recursive: true });
    try {
      await fs.writeFile(
        path.join(staging, "package.json"),
        `${JSON.stringify({ private: true })}\n`,
      );
      const npmrc = path.join(staging, ".npmrc");
      if (job?.runModule) await fs.writeFile(npmrc, MODULE_PACKAGES.npmrc);
      else if (job) await fs.copyFile(path.join(job.cwd, ".npmrc"), npmrc).catch(() => undefined);
      const result = await this.run(
        "npm",
        ["install", SASS_PACKAGE, "--no-audit", "--no-fund", "--ignore-scripts"],
        {
          cwd: staging,
          timeoutMs: SASS_INSTALL_TIMEOUT_MS,
          ...(job?.runModule ? { env: runBuildEnv({ install: true }) } : {}),
        },
      );
      if (result.code !== 0 || result.error)
        throw new Error(
          `Installing ${SASS_PACKAGE} failed${result.error ? ` (${result.error})` : ""}: ${result.tail.trim()}`,
        );
      await fs.rm(npmrc, { force: true });
      // Another server process may have finished first; its install is as good as this one.
      // An install cut short before this rename existed is replaced.
      if (!(await installedSass(this.home)))
        await fs.rm(this.home, { recursive: true, force: true });
      await fs.rename(staging, this.home).catch(() => undefined);
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
    const cli = await installedSass(this.home);
    if (!cli) throw new Error(`Installing ${SASS_PACKAGE} left no sass command line.`);
    return cli;
  }

  /** Compiles one stylesheet: `sass <from> <to> --no-source-map`, as a deploy runs it. */
  async compile(job: StyleJob): Promise<StyleResult> {
    let argv: [string, ...string[]];
    try {
      argv = [process.execPath, await this.cli(job), job.from, job.to, "--no-source-map"];
      if (job.confine) argv = confinedArgv(job.confine, argv);
    } catch (error) {
      return { code: 1, tail: (error as Error).message };
    }
    const [command, ...args] = argv;
    return this.run(command, args, {
      cwd: job.cwd,
      shell: false,
      ...(job.env ? { env: job.env } : {}),
      ...(job.signal ? { signal: job.signal } : {}),
      ...(job.onOutput ? { onOutput: job.onOutput } : {}),
    });
  }
}

@Component()
export class DefaultModuleBuilder implements ModuleBuilder {
  @Use() private readonly config!: Config;
  @Use() private readonly settings!: Settings;
  @Use(SandboxModule) private readonly sandbox!: Sandbox;

  private builds: ModuleBuilder | null = null;

  /** Made on first use, once the config is there to say where the Sass goes. */
  private real(): ModuleBuilder {
    if (!this.builds) {
      const sass = new PinnedSass(sassHome(this.config.root));
      // Read as each build starts: an admin's switch applies to the next build.
      this.builds = moduleBuilds(
        (job) => sass.compile(job),
        () => (this.settings.getConfineActivityAgents() ? this.sandbox.confiner() : null),
      );
    }
    return this.builds;
  }

  compileStyle(job: StyleJob): Promise<StyleResult> {
    return this.real().compileStyle(job);
  }

  buildRun(workspace: string): Promise<BuildOutcome> {
    return this.real().buildRun(workspace);
  }

  buildCheckout(job: CheckoutBuildJob): Promise<BuildOutcome> {
    return this.real().buildCheckout(job);
  }

  buildPlayer(job: PlayerBuildJob): Promise<BuildOutcome> {
    return this.real().buildPlayer(job);
  }
}
