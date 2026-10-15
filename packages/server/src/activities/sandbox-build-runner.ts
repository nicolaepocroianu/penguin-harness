/**
 * Running a module's own build.
 *
 * `SandboxBuilder` decides *whether* to build and makes sure only one build runs at a time.
 * This is the part it injects: the child process that actually does it.
 *
 * The module scaffold ships `webpack.config.cjs` and a `buildDebug` script (waf-module.ts),
 * the same one the deploy runs, so the module's own toolchain is what runs — not the
 * harness's. A preview built by anything else would be a
 * preview of something the deployment will never produce.
 *
 * A run's module is code its agent wrote, its package.json scripts and webpack config
 * included, and building it runs that code here. So a run build starts its programs with
 * none of this server's environment, and, while activity agents are confined, in the sandbox
 * the agent's own commands ran in: writable in the module folder and nowhere else, so the
 * shared module packages it links in, the rest of the run and the WAF checkout stay as they
 * were.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { SpawnConfiner } from "@prismshadow/penguin-core";
import type { StyleCompiler } from "./module-builder.js";
import { RUN_SANDBOX_MODE } from "./run-sandbox.js";
import {
  clampLog,
  runProgram,
  type ProgramConfiner,
  type ProgramResult,
  type ProgramSpec,
} from "./run-program.js";
import { RUN_BUILD_NPM_CACHE } from "./sandbox-source.js";

/** Long enough for a cold webpack build, short enough that a hung one is not forever. */
export const BUILD_TIMEOUT_MS = 10 * 60 * 1000;

/** How much build output is kept. A webpack failure is readable well within this. */
export const BUILD_LOG_MAX = 256 * 1024;

export interface BuildOutcome {
  ok: boolean;
  log: string;
}

/** How a run build's programs are started: with this environment, and confined when it says. */
interface RunBuildSpawn {
  env: NodeJS.ProcessEnv;
  confine?: ProgramConfiner;
}

/**
 * What a run build's programs keep of this process's environment: what Windows, Node and npm
 * need to start (the PATH, the temporary folder, the system folder and shell, the user folders
 * npm finds its settings in). Never a key, a token or a `PENGUIN_*` setting.
 */
const RUN_BUILD_ENV = new Set([
  "PATH",
  "PATHEXT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "WINDIR",
  "COMSPEC",
]);

/**
 * What an npm install made for a run build keeps besides: how npm reaches a registry from this
 * machine. Such an install runs none of the module's code, so a proxy's credentials reach npm
 * alone; a build's own programs never get them.
 */
const NPM_NETWORK_ENV = new Set(["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "NODE_EXTRA_CA_CERTS"]);

/**
 * This process's environment as a run build's programs start with it (`RUN_BUILD_ENV`), or,
 * with `install`, as an npm install made for the build starts with it (`NPM_NETWORK_ENV` too).
 */
export function runBuildEnv(options: { install?: boolean } = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  // By name whatever its case: Windows keeps the case a name was written in (`Path`).
  for (const [key, value] of Object.entries(process.env)) {
    const name = key.toUpperCase();
    const kept = RUN_BUILD_ENV.has(name) || (options.install === true && NPM_NETWORK_ENV.has(name));
    if (value !== undefined && kept) env[key] = value;
  }
  // Under the desktop app this process's interpreter is Electron, which runs a script only with
  // this set; the Sass compile and the Windows sandbox runner both start it.
  if (process.versions.electron !== undefined) env.ELECTRON_RUN_AS_NODE = "1";
  return env;
}

/**
 * How the programs of a build of the run module at `moduleRoot` start (see the top of this
 * file): `confiner` is the session sandbox's, or null while activity agents are not confined.
 */
function runBuildSpawn(moduleRoot: string, confiner: SpawnConfiner | null): RunBuildSpawn {
  const env = runBuildEnv();
  if (!confiner) return { env };
  // npm keeps its cache in the user's profile, which a confined build cannot write.
  env.npm_config_cache = path.join(moduleRoot, RUN_BUILD_NPM_CACHE);
  return {
    env,
    confine: (argv) =>
      confiner(argv, { cwd: moduleRoot, workspaceDir: moduleRoot, sessionMode: RUN_SANDBOX_MODE }),
  };
}

/** What a build's log ends with when it did not succeed. */
function buildTrailer(result: ProgramResult): string | null {
  switch (result.outcome) {
    case "exited":
      return result.code === 0 ? null : `The build exited with code ${result.code}.`;
    case "timed_out":
      return "The build was stopped after taking too long.";
    case "not_found":
      return result.code === null
        ? `The build could not be started: ${result.error}`
        : `The build exited with code ${result.code}: a program it runs was not found.`;
    default:
      return `The build could not be started: ${result.error ?? result.outcome}`;
  }
}

/**
 * Runs one build child and reports how it went. Never throws: a build that could not start
 * is a failed build with a reason.
 */
async function runBuildChild(
  spec: Omit<ProgramSpec, "timeoutMs" | "outputMax">,
  options: { timeoutMs?: number },
): Promise<BuildOutcome> {
  const result = await runProgram({
    ...spec,
    timeoutMs: options.timeoutMs ?? BUILD_TIMEOUT_MS,
    outputMax: BUILD_LOG_MAX,
  });
  const trailer = buildTrailer(result);
  return {
    ok: trailer === null,
    log: clampLog(result.output + (trailer ? `\n${trailer}` : ""), BUILD_LOG_MAX, result.omitted),
  };
}

/**
 * The script a module builds with: its own `build` when it has one, else the scaffold's
 * `buildDebug`, which writes to `dist/debug`. Null when it has neither, or no readable
 * package.json.
 */
export function moduleBuildScript(workspace: string): "build" | "buildDebug" | null {
  let scripts: unknown;
  try {
    scripts = JSON.parse(readFileSync(path.join(workspace, "package.json"), "utf8"))?.scripts;
  } catch {
    return null;
  }
  if (!scripts || typeof scripts !== "object") return null;
  const named = scripts as Record<string, unknown>;
  if (typeof named.build === "string") return "build";
  if (typeof named.buildDebug === "string") return "buildDebug";
  return null;
}

/** A stylesheet compile as a build step's outcome, saying what it compiled when it did. */
export function styleOutcome(
  result: { code: number | null; tail: string; error?: string },
  from: string,
  to: string,
): BuildOutcome {
  if (result.code === 0 && !result.error)
    return { ok: true, log: `${result.tail}Compiled ${from} to ${to}.\n` };
  let why = `${from} did not compile.`;
  if (result.error === "timed_out")
    why = "The stylesheet compile was stopped after taking too long.";
  else if (result.error === "stopped") why = "The stylesheet compile was stopped.";
  return { ok: false, log: clampLog(`${result.tail}\n${why}`, BUILD_LOG_MAX) };
}

/**
 * Runs the module's build script (see `moduleBuildScript`) in its workspace and reports how
 * it went, compiling `res/style.scss` to `res/style.css` first as deploy does: WAF's module
 * builder copies `res/` as it finds it and only rewrites `url()`s in `.css`, so a module whose
 * stylesheet is SCSS would build without the `style.css` its definition requires.
 *
 * Never throws. A build that could not start is a failed build with a reason — the author
 * asked to see their activity, and "npm is not installed" is an answer to that, while an
 * exception thrown at whoever happened to request the preview is not.
 *
 * Both programs start as `runBuildSpawn` says, through `confiner` when there is one; a
 * program the sandbox will not confine does not run, and the build fails saying why.
 *
 * `npm_config_ignore_scripts` is not set here: the module's `.npmrc` already sets
 * `ignore-scripts`, and the build itself is a script.
 */
export async function spawnModuleBuild(
  workspace: string,
  options: { timeoutMs?: number; compileStyle: StyleCompiler; confiner?: SpawnConfiner | null },
): Promise<BuildOutcome> {
  const script = moduleBuildScript(workspace);
  if (!script)
    return { ok: false, log: "The module's package.json has no build or buildDebug script." };
  const spawn = runBuildSpawn(workspace, options.confiner ?? null);
  let styleLog = "";
  if (existsSync(path.join(workspace, "res", "style.scss"))) {
    const style = styleOutcome(
      await options.compileStyle({
        cwd: workspace,
        from: "res/style.scss",
        to: "res/style.css",
        runModule: true,
        ...spawn,
      }),
      "res/style.scss",
      "res/style.css",
    );
    if (!style.ok) return style;
    styleLog = style.log;
  }
  const build = await runBuildChild(
    { command: "npm", args: ["run", script], cwd: workspace, windowsShell: true, ...spawn },
    options,
  );
  return { ok: build.ok, log: clampLog(styleLog + build.log, BUILD_LOG_MAX) };
}

/**
 * Runs a build script with this process's own Node, the script arriving on stdin.
 *
 * On stdin rather than as `-e`: a script long enough to be useful is past what a Windows
 * command line holds, and nothing on stdin needs quoting.
 */
export function spawnNodeScript(
  script: string,
  input: { cwd: string; env: Record<string, string> },
  options: { timeoutMs?: number } = {},
): Promise<BuildOutcome> {
  return runBuildChild(
    {
      command: process.execPath,
      args: ["-"],
      cwd: input.cwd,
      env: { ...process.env, ...input.env },
      input: script,
    },
    options,
  );
}
