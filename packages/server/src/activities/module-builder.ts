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
 * Tests replace `ModuleBuilder` with builds over a fake compiler; nothing here is reached by a
 * test that installs a package.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Component, Interface, Use } from "@prismshadow/penguin-core/kernel";
import type { Config } from "../hmr/capabilities.js";
import {
  spawnDeployProcess,
  type DeployProcess,
  type DeployProcessResult,
} from "./deploy-process.js";
import { spawnModuleBuild, spawnNodeScript, type BuildOutcome } from "./sandbox-build-runner.js";
import { spawnCheckoutBuild, type CheckoutBuildJob } from "./sandbox-checkout-build.js";
import { PLAYER_BUILD_SCRIPT, PLAYER_SOURCE } from "./sandbox-player.js";

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
  /** A run workspace's module, built in place by its own script, its stylesheet first. */
  buildRun(workspace: string): Promise<BuildOutcome>;
  /** A checkout module, built into Penguin's output without writing to the checkout. */
  buildCheckout(job: CheckoutBuildJob): Promise<BuildOutcome>;
  /** The player bundle, built from the checkout's framework. */
  buildPlayer(job: PlayerBuildJob): Promise<BuildOutcome>;
}>() {}

/** The builds, over one stylesheet compiler: the real one, or a test's. */
export function moduleBuilds(compileStyle: StyleCompiler): ModuleBuilder {
  return {
    compileStyle,
    buildRun: (workspace) => spawnModuleBuild(workspace, { compileStyle }),
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
 */
export class PinnedSass {
  private installing: Promise<string> | null = null;

  constructor(
    private readonly home: string,
    private readonly run: DeployProcess["run"] = spawnDeployProcess.run,
  ) {}

  /** The command line script, installing the pinned Sass first when it is not there. */
  cli(): Promise<string> {
    this.installing ??= this.install().catch((error: unknown) => {
      this.installing = null;
      throw error;
    });
    return this.installing;
  }

  private async install(): Promise<string> {
    const ready = await installedSass(this.home);
    if (ready) return ready;
    const staging = `${this.home}.${process.pid}.${Date.now()}.partial`;
    await fs.mkdir(staging, { recursive: true });
    try {
      await fs.writeFile(
        path.join(staging, "package.json"),
        `${JSON.stringify({ private: true })}\n`,
      );
      const result = await this.run(
        "npm",
        ["install", SASS_PACKAGE, "--no-audit", "--no-fund", "--ignore-scripts"],
        { cwd: staging, timeoutMs: SASS_INSTALL_TIMEOUT_MS },
      );
      if (result.code !== 0 || result.error)
        throw new Error(
          `Installing ${SASS_PACKAGE} failed${result.error ? ` (${result.error})` : ""}: ${result.tail.trim()}`,
        );
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
    let cli: string;
    try {
      cli = await this.cli();
    } catch (error) {
      return { code: 1, tail: (error as Error).message };
    }
    return this.run(process.execPath, [cli, job.from, job.to, "--no-source-map"], {
      cwd: job.cwd,
      shell: false,
      ...(job.signal ? { signal: job.signal } : {}),
      ...(job.onOutput ? { onOutput: job.onOutput } : {}),
    });
  }
}

@Component()
export class DefaultModuleBuilder implements ModuleBuilder {
  @Use() private readonly config!: Config;

  private builds: ModuleBuilder | null = null;

  /** Made on first use, once the config is there to say where the Sass goes. */
  private real(): ModuleBuilder {
    if (!this.builds) {
      const sass = new PinnedSass(sassHome(this.config.root));
      this.builds = moduleBuilds((job) => sass.compile(job));
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
