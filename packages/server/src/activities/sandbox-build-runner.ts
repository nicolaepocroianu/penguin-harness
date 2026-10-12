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
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { StyleCompiler } from "./module-builder.js";
import { clampLog, runProgram, type ProgramResult, type ProgramSpec } from "./run-program.js";

/** Long enough for a cold webpack build, short enough that a hung one is not forever. */
export const BUILD_TIMEOUT_MS = 10 * 60 * 1000;

/** How much build output is kept. A webpack failure is readable well within this. */
export const BUILD_LOG_MAX = 256 * 1024;

export interface BuildOutcome {
  ok: boolean;
  log: string;
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
 * `npm_config_ignore_scripts` is not set here: the module's `.npmrc` already sets
 * `ignore-scripts`, and the build itself is a script.
 */
export async function spawnModuleBuild(
  workspace: string,
  options: { timeoutMs?: number; compileStyle: StyleCompiler },
): Promise<BuildOutcome> {
  const script = moduleBuildScript(workspace);
  if (!script)
    return { ok: false, log: "The module's package.json has no build or buildDebug script." };
  let styleLog = "";
  if (existsSync(path.join(workspace, "res", "style.scss"))) {
    const style = styleOutcome(
      await options.compileStyle({ cwd: workspace, from: "res/style.scss", to: "res/style.css" }),
      "res/style.scss",
      "res/style.css",
    );
    if (!style.ok) return style;
    styleLog = style.log;
  }
  const build = await runBuildChild(
    { command: "npm", args: ["run", script], cwd: workspace, windowsShell: true },
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
