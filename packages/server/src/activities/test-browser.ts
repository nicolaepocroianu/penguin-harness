/**
 * The test browser: a Chromium Penguin owns, for quality checks and acceptance tests to open
 * an activity's player in.
 *
 * It lives under `PENGUIN_HOME/browsers`, where Playwright is told to look
 * (`PLAYWRIGHT_BROWSERS_PATH`), never in the user's own Playwright cache: what a check runs
 * against is the browser this server's `playwright-core` was built for, and nothing else on
 * the machine moves it. A release package ships one beside the program (the launcher names
 * it in `PENGUIN_BUNDLED_BROWSERS`), which is used as it is when the home has none; anywhere
 * else an admin installs it with one action. Nothing installs it on its own.
 *
 * The install is Playwright's own installer run as a child process — no shell, a time limit,
 * a bounded log, one at a time. What it downloads, and from where, is Playwright's business;
 * the server only reports whether Playwright finished installing it where it will look.
 *
 * Tests never download anything: the installer and the executable lookup are ports
 * (`TestBrowserPorts`) a test replaces.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  Component,
  Interface,
  Use,
  type ClassCtx,
  type Opaque,
} from "@prismshadow/penguin-core/kernel";
import { HttpError } from "../http/errors.js";
import type { Config } from "../hmr/capabilities.js";
import type { Settings } from "../mechanisms/settings.js";
import { loopbackHostRoles } from "../services/preview-token.js";
import { PLAYER_BROWSER_ARGS } from "./browser-session.js";
import {
  runConfinedChecks,
  type ChecksOutcome,
  type ChecksRequest,
  type ConfinedChecksRequest,
} from "./confined-checks.js";
import { playBase } from "./play-routes.js";
import { clampLog, runProgram } from "./run-program.js";
import type { ActivityPlayLinks } from "./play-links.js";
import type { TestBrowserInstallError, TestBrowserStatus } from "./test-browser-types.js";

export type {
  TestBrowserInstallError,
  TestBrowserStatus,
  TestBrowserStatusResponse,
} from "./test-browser-types.js";

/** Long enough for a slow download of a large browser, short enough that a hung one ends. */
export const INSTALL_TIMEOUT_MS = 15 * 60 * 1000;

/** How much installer output is kept while it runs. */
export const INSTALL_LOG_MAX = 64 * 1024;

/** How much of a failed install's output the status carries: the end, where the error is. */
export const STATUS_LOG_TAIL = 4000;

/** The directory under PENGUIN_HOME the browser is installed into. */
export const BROWSERS_DIR_NAME = "browsers";

/**
 * The file Playwright writes into a browser's directory (`<browsers>/chromium-<rev>/`) as the
 * last step of an install. An executable without it is a download that was stopped part way.
 */
export const INSTALL_MARKER = "INSTALLATION_COMPLETE";

/**
 * Whether `executable` belongs to a browser Playwright finished installing under
 * `browsersDir`: the executable is there, and so is the marker in its browser's directory.
 */
export function installComplete(browsersDir: string, executable: string): boolean {
  const relative = path.relative(browsersDir, executable);
  const browserDir = relative.split(/[\\/]/)[0];
  if (!browserDir || browserDir === ".." || path.isAbsolute(relative)) return false;
  return (
    fs.existsSync(executable) && fs.existsSync(path.join(browsersDir, browserDir, INSTALL_MARKER))
  );
}

/**
 * The environment for a child that runs a script on this server's own interpreter. Under the
 * desktop app that interpreter is the Electron binary, which runs a script only with
 * `ELECTRON_RUN_AS_NODE` set; without it the child would start a second copy of the app.
 */
export function nodeChildEnv(
  extra: Record<string, string>,
  electron = process.versions.electron !== undefined,
): NodeJS.ProcessEnv {
  return { ...process.env, ...extra, ...(electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) };
}

/** What the installer is asked to do. */
export interface TestBrowserInstallSpec {
  /** Playwright's command-line entry (`playwright-core/cli.js`). */
  cliPath: string;
  /** Where the browser goes. */
  browsersDir: string;
  /** Extra environment for the child (the browsers path, and the proxy when one applies). */
  env: Record<string, string>;
  timeoutMs: number;
  /** Aborted when the server shuts down; the child is stopped. */
  signal: AbortSignal;
}

export interface TestBrowserInstallOutcome {
  result: "ok" | "failed" | "timed_out" | "not_started";
  log: string;
}

/**
 * The parts of the test browser that touch the outside world. Every field is optional:
 * absent, the real one is used; a test stands in fakes so nothing is spawned or downloaded.
 */
export abstract class TestBrowserPorts extends Interface<{
  /** Runs the installer to completion. Never throws. */
  runInstall?: (spec: TestBrowserInstallSpec) => Promise<TestBrowserInstallOutcome>;
  /** Where Playwright looks for Chromium's executable under `browsersDir`; null if nowhere. */
  locateExecutable?: (browsersDir: string) => Promise<string | null>;
  /** The browsers directory a release package ships; null for none. */
  bundledDir?: string | null;
  /** The `playwright-core` package directory; null stands for a Penguin that ships none. */
  playwrightCoreDir?: string | null;
  /** Starts the browser as a Playwright server (see `launchPlaywrightServer`). */
  launchServer?: (executable: string, coreDir: string) => Promise<BrowserServerHandle>;
  /** Runs an earlier run's checks, confined (see `runConfinedChecks`). */
  runChecks?: (request: ConfinedChecksRequest) => Promise<ChecksOutcome>;
}>() {}

/** A test browser this server runs for one activity run: where to reach it, and how to stop it. */
export interface BrowserServerHandle {
  /** The Playwright protocol address the run's checks connect to (`chromium.connect`). */
  endpoint: string;
  close(): Promise<void>;
}

/**
 * Starts Chromium as a Playwright browser server, outside any sandbox. A confined run's agent
 * cannot start Chromium itself (on Windows its process channel is refused to a restricted
 * token), so the server starts it and the agent's checks, still confined, connect to it.
 *
 * Bound to the loopback address: by default Playwright listens on every interface, which would
 * hand the browser to anyone on the network. A connection speaks Playwright's own protocol, not
 * raw DevTools, so a download comes back to the confined client rather than being written by
 * the browser wherever it is told. The path in the address is Playwright's random one.
 */
export async function launchPlaywrightServer(
  executable: string,
  coreDir: string,
): Promise<BrowserServerHandle> {
  const { chromium } = createRequire(import.meta.url)(path.join(coreDir, "index.js")) as {
    chromium: {
      launchServer(options: {
        executablePath: string;
        headless: boolean;
        host: string;
        args: string[];
      }): Promise<{ wsEndpoint(): string; close(): Promise<void> }>;
    };
  };
  const server = await chromium.launchServer({
    executablePath: executable,
    headless: true,
    host: "127.0.0.1",
    // Started as every other player check's browser is, or the activity pauses for audio.
    args: PLAYER_BROWSER_ARGS,
  });
  return { endpoint: server.wsEndpoint(), close: () => server.close() };
}

@Component()
export class DefaultTestBrowserPorts implements TestBrowserPorts {}

/** The installed `playwright-core` package directory, or null when it cannot be found. */
export function playwrightCoreDir(): string | null {
  try {
    return path.dirname(createRequire(import.meta.url).resolve("playwright-core/package.json"));
  } catch {
    return null;
  }
}

/** The Chromium version a `playwright-core` directory drives, from its `browsers.json`. */
export function chromiumVersion(coreDir: string | null): string | null {
  if (!coreDir) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(coreDir, "browsers.json"), "utf8")) as {
      browsers?: Array<{ name?: string; browserVersion?: string }>;
    };
    const entry = manifest.browsers?.find((browser) => browser.name === "chromium");
    return typeof entry?.browserVersion === "string" ? entry.browserVersion : null;
  } catch {
    return null;
  }
}

/**
 * Runs Playwright's installer for Chromium. `--no-shell`: checks launch the full browser by
 * its executable path, so the separate headless shell would be a second download for nothing.
 */
export async function spawnPlaywrightInstall(
  spec: TestBrowserInstallSpec,
): Promise<TestBrowserInstallOutcome> {
  if (spec.signal.aborted) return { result: "not_started", log: "" };
  const run = await runProgram({
    command: process.execPath,
    args: [spec.cliPath, "install", "--no-shell", "chromium"],
    cwd: spec.browsersDir,
    env: nodeChildEnv(spec.env),
    timeoutMs: spec.timeoutMs,
    signal: spec.signal,
    outputMax: INSTALL_LOG_MAX,
  });
  const outcome = (result: TestBrowserInstallOutcome["result"], trailer?: string) => ({
    result,
    log: clampLog(run.output + (trailer ? `\n${trailer}` : ""), INSTALL_LOG_MAX, run.omitted),
  });
  switch (run.outcome) {
    case "exited":
      return run.code === 0 ? outcome("ok") : outcome("failed", `exit code ${run.code}`);
    case "timed_out":
      return outcome("timed_out");
    case "stopped":
      return outcome("failed", "stopped");
    default:
      return run.code === null
        ? outcome("not_started", run.error)
        : outcome("failed", `exit code ${run.code}`);
  }
}

/**
 * Asks Playwright where Chromium's executable is under `browsersDir`. In a child, because
 * Playwright reads `PLAYWRIGHT_BROWSERS_PATH` once, when it is first loaded: asking in this
 * process would pin the answer to whatever the environment held then, and setting it here
 * would leak into every agent this server starts.
 */
export async function locatePlaywrightChromium(browsersDir: string): Promise<string | null> {
  const coreDir = playwrightCoreDir();
  if (!coreDir) return null;
  const script =
    "const { chromium } = require(process.argv[1]);" +
    "process.stdout.write(String(chromium.executablePath() || ''));";
  const run = await runProgram({
    command: process.execPath,
    args: ["-e", script, path.join(coreDir, "index.js")],
    env: nodeChildEnv({ PLAYWRIGHT_BROWSERS_PATH: browsersDir }),
    timeoutMs: 30_000,
  });
  const found = run.stdout.trim();
  return run.outcome === "exited" && run.code === 0 && found !== "" ? found : null;
}

/** The loopback authority this server answers on, for a browser on the same machine. */
export function loopbackAuthority(bind: { host: string; port: number }): string {
  let host = bind.host.trim();
  if (host === "" || host === "0.0.0.0") host = "127.0.0.1";
  else if (host === "::" || host === "[::]") host = "::1";
  const literal = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `${literal}:${bind.port}`;
}

export interface PlayUrlOptions {
  /** The scene to open on; the activity's own start when absent. */
  scene?: string;
  /** The language to play in; the default language when absent. */
  language?: string;
  /** A module run of the activity to play, while it runs, instead of its playing build. */
  runId?: string;
}

export abstract class TestBrowser extends Interface<{
  /** Whether the browser is installed, and whether an install is running. */
  status(): Promise<TestBrowserStatus>;
  /** Starts an install (admin action only); 409 while one runs. Returns the status at once. */
  install(): Promise<TestBrowserStatus>;
  /** The executable to launch, or null when the browser is not installed. */
  executablePath(): Promise<string | null>;
  /** A signed link that plays an activity, for the test browser on this machine to open. */
  playUrl(projectId: string, activityId: string, options?: PlayUrlOptions): Promise<string>;
  /**
   * Starts the test browser as a server for one run, or null when it is not installed. The
   * caller stops it when the run ends.
   */
  launchServer(): Promise<Opaque<"BrowserServerHandle", BrowserServerHandle> | null>;
  /**
   * Runs checks an earlier test run wrote against their play link, as the server's own work
   * (decision 17): with this server's harness and runner, confined, in the test browser locked
   * to the play link. Answers the results, or why the checks could not run; never throws.
   */
  runChecks(
    request: ChecksRequest,
    signal: Opaque<"AbortSignal", AbortSignal>,
  ): Promise<ChecksOutcome>;
}>() {}

@Component()
export class TestBrowserService implements TestBrowser {
  @Use() private readonly config!: Config;
  @Use() private readonly settings!: Settings;
  @Use() private readonly links!: ActivityPlayLinks;
  @Use() private readonly ports!: TestBrowserPorts;

  private installing = false;
  private lastError: TestBrowserInstallError | null = null;
  private lastLog: string | null = null;
  private readonly located = new Map<string, Promise<string | null>>();
  private readonly shutdown = new AbortController();

  setup({ effect }: ClassCtx) {
    effect(() => this.shutdown.abort());
  }

  /** Where this server installs the browser. */
  private homeDir(): string {
    return path.join(this.config.root, BROWSERS_DIR_NAME);
  }

  /**
   * The `playwright-core` this server installs and drives the browser with. The desktop app
   * bundles the server into one file and ships no `playwright-core` package beside it, so
   * there this is null and the test browser is unavailable.
   */
  private coreDir(): string | null {
    return this.ports.playwrightCoreDir !== undefined
      ? this.ports.playwrightCoreDir
      : playwrightCoreDir();
  }

  private bundledDir(): string | null {
    const dir = this.ports.bundledDir ?? process.env.PENGUIN_BUNDLED_BROWSERS ?? null;
    return dir && dir.trim() !== "" ? dir : null;
  }

  /** Where the executable is under `dir`, asked once per directory: it cannot move. */
  private locate(dir: string): Promise<string | null> {
    let found = this.located.get(dir);
    if (!found) {
      const lookup = this.ports.locateExecutable ?? locatePlaywrightChromium;
      found = lookup(dir).catch(() => null);
      // A failed lookup is not remembered: the next status asks again.
      void found.then((value) => {
        if (value === null) this.located.delete(dir);
      });
      this.located.set(dir, found);
    }
    return found;
  }

  /** The directory in use and its executable, when one of them has the browser. */
  private async resolve(): Promise<{ dir: string; executable: string | null }> {
    const home = this.homeDir();
    const bundled = this.bundledDir();
    for (const dir of bundled ? [home, bundled] : [home]) {
      const executable = await this.locate(dir);
      if (executable && installComplete(dir, executable)) return { dir, executable };
    }
    return { dir: home, executable: null };
  }

  async status(): Promise<TestBrowserStatus> {
    const coreDir = this.coreDir();
    const { dir, executable } = await this.resolve();
    return {
      available: coreDir !== null,
      installed: executable !== null,
      version: chromiumVersion(coreDir),
      path: dir,
      installing: this.installing,
      error: this.installing ? null : this.lastError,
      log: this.installing || this.lastError === null ? null : this.lastLog,
    };
  }

  async executablePath(): Promise<string | null> {
    return (await this.resolve()).executable;
  }

  async launchServer(): Promise<BrowserServerHandle | null> {
    const coreDir = this.coreDir();
    const executable = await this.executablePath();
    if (coreDir === null || executable === null) return null;
    return (this.ports.launchServer ?? launchPlaywrightServer)(executable, coreDir);
  }

  async runChecks(request: ChecksRequest, signal: AbortSignal): Promise<ChecksOutcome> {
    const coreDir = this.coreDir();
    if (coreDir === null)
      return {
        ran: false,
        reason: "This copy of Penguin does not include Playwright, so it cannot run the tests.",
      };
    const executable = await this.executablePath();
    if (executable === null)
      return {
        ran: false,
        reason: "The test browser is not installed. An admin installs it in Settings.",
      };
    return (this.ports.runChecks ?? runConfinedChecks)({
      ...request,
      signal,
      executable,
      coreDir,
    });
  }

  async install(): Promise<TestBrowserStatus> {
    if (this.coreDir() === null) {
      throw new HttpError(
        503,
        "test_browser_unavailable",
        "This copy of Penguin does not include Playwright, so it cannot install the test browser.",
      );
    }
    if (this.installing) {
      throw new HttpError(
        409,
        "test_browser_installing",
        "The test browser is already installing.",
      );
    }
    this.installing = true;
    this.lastError = null;
    this.lastLog = null;
    void this.runInstall();
    return this.status();
  }

  private async runInstall(): Promise<void> {
    const dir = this.homeDir();
    try {
      const coreDir = this.coreDir();
      let outcome: TestBrowserInstallOutcome;
      if (!coreDir) {
        outcome = { result: "not_started", log: "playwright-core is not installed." };
      } else {
        await fs.promises.mkdir(dir, { recursive: true });
        const env: Record<string, string> = { PLAYWRIGHT_BROWSERS_PATH: dir };
        // The download is this server's own outbound traffic, so it follows the app proxy.
        const proxy = this.settings.getProxyForApp() ? this.settings.getProxyUrl() : null;
        if (proxy) {
          env.HTTPS_PROXY = proxy;
          env.HTTP_PROXY = proxy;
        }
        const run = this.ports.runInstall ?? spawnPlaywrightInstall;
        outcome = await run({
          cliPath: path.join(coreDir, "cli.js"),
          browsersDir: dir,
          env,
          timeoutMs: INSTALL_TIMEOUT_MS,
          signal: this.shutdown.signal,
        });
      }
      this.located.delete(dir);
      const executable = await this.locate(dir);
      const present = executable !== null && installComplete(dir, executable);
      this.lastError = outcome.result === "ok" ? (present ? null : "incomplete") : outcome.result;
      this.lastLog = this.lastError === null ? null : outcome.log.slice(-STATUS_LOG_TAIL);
    } catch (error) {
      this.lastError = "not_started";
      this.lastLog = (error as Error).message.slice(-STATUS_LOG_TAIL);
    } finally {
      this.installing = false;
    }
  }

  async playUrl(projectId: string, activityId: string, options: PlayUrlOptions = {}) {
    if (this.config.port === 0) {
      throw new HttpError(503, "server_not_listening", "The server has not started listening yet.");
    }
    // The loopback preview host where there is one, so the page is served as is: sandboxed,
    // with an opaque origin, it would lose the player's storage (see play-routes.ts). Made
    // here rather than by the sandbox, which plays module runs and so cannot be depended on
    // by the run that stages this link. Every caller has already loaded the activity, so the
    // sandbox's existence check would add nothing.
    const roles = this.config.previewOrigin ? null : loopbackHostRoles(this.config.host);
    const authority = roles
      ? loopbackAuthority({ host: roles.preview, port: this.config.port })
      : loopbackAuthority(this.config);
    const key = this.links.link({
      projectId,
      activityId,
      ...(options.runId ? { runId: options.runId } : {}),
    });
    const query = new URLSearchParams();
    if (options.language) query.set("language", options.language);
    if (options.scene) query.set("scene", options.scene);
    const search = query.toString();
    return `http://${authority}${playBase(key)}play${search ? `?${search}` : ""}`;
  }
}
