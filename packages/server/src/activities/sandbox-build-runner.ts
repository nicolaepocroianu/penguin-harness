/**
 * Running a module's own build.
 *
 * `SandboxBuilder` decides *whether* to build and makes sure only one build runs at a time.
 * This is the part it injects: the child process that actually does it.
 *
 * The module scaffold ships `webpack.config.cjs` and a `build` script, so the module's own
 * toolchain is what runs — not the harness's. A preview built by anything else would be a
 * preview of something the deployment will never produce.
 */
import { spawn } from "node:child_process";

/** Long enough for a cold webpack build, short enough that a hung one is not forever. */
export const BUILD_TIMEOUT_MS = 10 * 60 * 1000;

/** How much build output is kept. A webpack failure is readable well within this. */
export const BUILD_LOG_MAX = 256 * 1024;

export interface BuildOutcome {
  ok: boolean;
  log: string;
}

/**
 * Keeps the *end* of the output when there is too much of it.
 *
 * The error is at the end. Truncating from the end would throw away the only part anyone
 * reads, which is what makes a log useless rather than merely long.
 */
export function clampLog(log: string, max = BUILD_LOG_MAX): string {
  if (log.length <= max) return log;
  return `… ${log.length - max} earlier characters omitted …\n${log.slice(-max)}`;
}

/**
 * Stops a build and everything it started.
 *
 * On Windows `npm` is a shell wrapper, so signalling the child kills the wrapper and leaves
 * webpack running — the process holds the workspace, `close` does not fire until the real
 * build finishes on its own, and a timeout that waits for it is not a timeout. Found by the
 * timeout test, which took the full sixty seconds it was meant to cut short.
 */
function stopTree(child: { pid?: number; kill(signal?: NodeJS.Signals): boolean }): void {
  if (process.platform === "win32" && child.pid) {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      return;
    } catch {
      // Fall through to the signal, which at least stops the wrapper.
    }
  }
  child.kill("SIGTERM");
  // A build ignoring SIGTERM would otherwise hold the workspace forever.
  setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
}

/**
 * Runs `npm run build` in a module workspace and reports how it went.
 *
 * Never throws. A build that could not start is a failed build with a reason — the author
 * asked to see their activity, and "npm is not installed" is an answer to that, while an
 * exception thrown at whoever happened to request the preview is not.
 *
 * `npm_config_ignore_scripts` is not set here: the module's `.npmrc` already sets
 * `ignore-scripts`, and the build itself is a script.
 */
export function spawnModuleBuild(
  workspace: string,
  options: { timeoutMs?: number } = {},
): Promise<BuildOutcome> {
  return new Promise((resolve) => {
    const chunks: string[] = [];
    let size = 0;
    const collect = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      chunks.push(text);
      size += text.length;
      // Bounded as it arrives: a build looping on an error can print gigabytes, and the
      // point of a log is the end of it.
      while (size > BUILD_LOG_MAX * 2 && chunks.length > 1) size -= chunks.shift()!.length;
    };
    const finish = (ok: boolean, trailer?: string) =>
      resolve({ ok, log: clampLog(chunks.join("") + (trailer ? `\n${trailer}` : "")) });

    let child;
    try {
      child = spawn("npm", ["run", "build"], {
        cwd: workspace,
        stdio: ["ignore", "pipe", "pipe"],
        // Windows resolves npm through its shell wrapper.
        shell: process.platform === "win32",
      });
    } catch (error) {
      finish(false, `The build could not be started: ${(error as Error).message}`);
      return;
    }

    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      stopTree(child);
    }, options.timeoutMs ?? BUILD_TIMEOUT_MS);
    timer.unref();

    child.on("error", (error: Error) => {
      clearTimeout(timer);
      finish(false, `The build could not be started: ${error.message}`);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) finish(false, "The build was stopped after taking too long.");
      else finish(code === 0, code === 0 ? undefined : `The build exited with code ${code}.`);
    });
  });
}
