/**
 * Checks an earlier test run wrote, run by the server itself (decision 17): when a test run
 * reuses a test file, no agent runs it, so nothing can edit what the checks rest on or write
 * their results by hand. The harness and the runner are this server's own copies, held in
 * memory, never the files in a run's folder.
 *
 * The test file is still an agent's code, so it runs as the activity bench's evaluator runs a
 * trial's tests (scripts/activity-bench/checks.ts):
 *
 * - in a child Node process under Node's permission model: it may read only `playwright-core`,
 *   and may not write, start a process or a worker, or load an addon or WASI. The child checks
 *   it is so confined before it runs anything. It is given only what Node itself needs (the
 *   PATH, the temporary folder, Windows' system folder), so none of this server's secrets; on
 *   Windows, process spawning adds a fixed few of its own (the user's name and profile folder
 *   among them), which name folders the child may not read.
 * - with its files served from memory by module hooks: the runner, the harness, the test file
 *   and the input never touch the disk, and the results come back over IPC.
 * - in the test browser locked down behind a guard (browser-guard.ts): a page reaches only the
 *   play link's own host and port, and a check may open nothing else, nor a local file.
 *
 * What none of this stops:
 *
 * - The network. Node's permission model does not limit it: the child can reach any host, this
 *   server's own loopback API among them, though with no session or token of its own, only as
 *   anyone unauthenticated could. It holds nothing to send but the test file, the criteria and
 *   the signed play link, which plays this one activity.
 * - The page's own origin. The page is same-origin with the play link, so it can reach every
 *   route this server answers on that host and port without authentication, as any visitor
 *   could.
 * - The test file's own results. The test file runs in the same process as the runner and can
 *   send results over the IPC channel itself, or change what the runner sends: what is protected
 *   is the harness, the runner and the input (no agent can change them), not the agent's own test
 *   file, which is run as an earlier run left it, by its digest.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  ACCEPTANCE_HARNESS_FILE,
  ACCEPTANCE_INPUT_FILE,
  ACCEPTANCE_RESULTS_FILE,
  ACCEPTANCE_RUNNER_FILE,
  ACCEPTANCE_TEST_FILE,
  activityHarnessSource,
  runAcceptanceSource,
} from "./acceptance-harness.js";
import type { AcceptanceInput } from "./acceptance-types.js";
import { startGuardedBrowser } from "./browser-guard.js";
import { PLAYER_BROWSER_ARGS } from "./browser-session.js";
import { runProgram } from "./run-program.js";

/** Long enough for any test file a run wrote (each check has two minutes, three at a time). */
export const CHECKS_TIMEOUT_MS = 30 * 60 * 1000;

/** How much of what the checks printed is kept to say why they could not run. */
const OUTPUT_MAX = 16 * 1024;

/** How long a reason may be. */
const REASON_MAX = 1000;

/** What the server runs an earlier run's checks with. */
export interface ChecksRequest {
  /** The test file, as the earlier run left it. */
  test: string;
  /** What the harness reads as its input: the play link, the viewport, the criteria, the scenes. */
  input: AcceptanceInput;
}

/** What came of it: the results the runner wrote, or why the checks could not run. */
export type ChecksOutcome = { ran: true; results: string } | { ran: false; reason: string };

export interface ConfinedChecksRequest extends ChecksRequest {
  /** Aborted when the run is cancelled or the server stops; the checks are stopped. */
  signal: AbortSignal;
  /** The test browser's executable. */
  executable: string;
  /** The `playwright-core` package directory the harness drives the browser with. */
  coreDir: string;
  timeoutMs?: number;
}

/**
 * The child's entry, run with `-e`. It refuses to run unless Node's permission model denies it
 * writes and processes, then serves the runner, the harness and the test file from memory and
 * imports the runner. Anything else a check imports is refused but Node's own modules and
 * `playwright-core`; `node:fs` is the shim, which reads the input from memory and sends the
 * results back. Exported for the test that starts it unconfined.
 */
export const CHILD_SOURCE = `import { isBuiltin, registerHooks } from "node:module";

const SHIM = "wafh-checks:fs";

function confined() {
  const permission = process.permission;
  if (!permission) return false;
  return !["fs.write", "child", "worker", "addon", "wasi"].some((scope) => permission.has(scope));
}

function hooks(payload) {
  return {
    resolve(specifier, context, nextResolve) {
      const parent = context.parentURL ?? "";
      if (specifier.startsWith(payload.base)) return { url: specifier, shortCircuit: true };
      if (!parent.startsWith(payload.base)) return nextResolve(specifier, context);
      if (specifier === "node:fs" || specifier === "fs") return { url: SHIM, shortCircuit: true };
      if (specifier === "playwright-core") return { url: payload.playwright, shortCircuit: true };
      if (isBuiltin(specifier)) return nextResolve(specifier, context);
      if (specifier.startsWith("./")) {
        const url = new URL(specifier, parent).href;
        if (Object.hasOwn(payload.files, url.slice(payload.base.length)))
          return { url, shortCircuit: true };
      }
      throw new Error("A check may import only the harness and Node's own modules: " + specifier);
    },
    load(url, context, nextLoad) {
      if (url === SHIM) return { format: "module", source: payload.shim, shortCircuit: true };
      if (url.startsWith(payload.base)) {
        const name = url.slice(payload.base.length);
        if (Object.hasOwn(payload.files, name))
          return { format: "module", source: payload.files[name], shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  };
}

process.once("message", async (payload) => {
  let failure = null;
  try {
    if (!confined()) throw new Error("Node's permission model is not confining the checks.");
    registerHooks(hooks(payload));
    await import(payload.base + payload.runner);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  // Sent after the results the runner sent, so the server has both before the exit.
  process.send({ type: "done", failure }, () => process.exit(failure ? 1 : 0));
});
`;

/** The `node:fs` the harness, the runner and the checks see: the input and results stay in memory. */
function fsShim(base: string, input: string): string {
  const names = Object.keys(fs).filter(
    (name) =>
      /^[A-Za-z_$][\w$]*$/.test(name) &&
      !["default", "readFileSync", "writeFileSync"].includes(name),
  );
  return `import fs from "node:fs";
const INPUT = ${JSON.stringify(`${base}${ACCEPTANCE_INPUT_FILE}`)};
const RESULTS = ${JSON.stringify(`${base}${ACCEPTANCE_RESULTS_FILE}`)};
const TEXT = ${JSON.stringify(input)};
const href = (file) => (file instanceof URL ? file.href : String(file));
const shim = {
  ...fs,
  readFileSync(file, ...rest) {
    if (href(file) !== INPUT) return fs.readFileSync(file, ...rest);
    const options = rest[0];
    const encoding = typeof options === "string" ? options : options && options.encoding;
    return encoding ? TEXT : Buffer.from(TEXT);
  },
  writeFileSync(file, data, ...rest) {
    if (href(file) !== RESULTS) return fs.writeFileSync(file, data, ...rest);
    process.send({ type: "results", text: String(data) });
  },
};
export default shim;
export const { ${names.join(", ")} } = shim;
export const readFileSync = shim.readFileSync;
export const writeFileSync = shim.writeFileSync;
`;
}

/**
 * The environment the child is given: what Node itself needs, the PATH, the temporary folder and
 * Windows' system folder; never this server's secrets. Windows' process spawning adds a few of
 * its own whatever it is given (see above).
 */
function plainEnv(): Record<string, string> {
  const keep = /^(PATH|TEMP|TMP|TMPDIR|SYSTEMROOT|WINDIR)$/i;
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env))
    if (value !== undefined && keep.test(key)) env[key] = value;
  return env;
}

const clip = (text: string) => (text.length > REASON_MAX ? `${text.slice(0, REASON_MAX)}…` : text);

/**
 * Why checks that ended on their own wrote no results: the child's own failure, sent over IPC,
 * first; else the line the runner prints when the tests could not run, which a check could also
 * print; else only the exit code is known.
 */
function whyNotRun(stderr: string, failure: string | null, code: number | null): string {
  if (failure !== null) return `The acceptance tests could not run: ${failure}`;
  const said = stderr
    .split(/\r?\n/)
    .reverse()
    .find((line) => line.startsWith("The acceptance tests could not run"));
  if (said) return said;
  return `The acceptance tests stopped before writing ${ACCEPTANCE_RESULTS_FILE} (exit code ${code}).`;
}

/** A time limit in words: whole minutes, or seconds under one. */
const limitText = (ms: number) =>
  ms >= 60_000 ? `${Math.round(ms / 60_000)} minutes` : `${Math.round(ms / 1000)} seconds`;

/**
 * Runs a test file against its play link, confined, in the locked-down test browser, and
 * answers what the runner wrote as its results; never throws.
 */
export async function runConfinedChecks(request: ConfinedChecksRequest): Promise<ChecksOutcome> {
  const stopped = { ran: false, reason: "The acceptance tests were stopped." } as const;
  const limitMs = request.timeoutMs ?? CHECKS_TIMEOUT_MS;
  if (request.signal.aborted) return stopped;
  let browser: Awaited<ReturnType<typeof startGuardedBrowser>>;
  try {
    browser = await startGuardedBrowser(
      request.executable,
      request.coreDir,
      PLAYER_BROWSER_ARGS,
      request.input.playUrl,
    );
  } catch (error) {
    return {
      ran: false,
      reason: clip(
        `The test browser did not start: ${error instanceof Error ? error.message : String(error)}`,
      ),
    };
  }
  try {
    if (request.signal.aborted) return stopped;
    // A folder that never exists: the modules' URLs, so the harness finds its siblings.
    const base = `${pathToFileURL(path.join(os.tmpdir(), `wafh-checks-${randomBytes(8).toString("hex")}`)).href}/`;
    const input = JSON.stringify({ ...request.input, browserEndpoint: browser.endpoint });
    const coreDir = fs.realpathSync(request.coreDir);
    const sent: { results: string | null; failure: string | null } = {
      results: null,
      failure: null,
    };
    const run = await runProgram({
      command: process.execPath,
      args: [
        "--permission",
        `--allow-fs-read=${coreDir}`,
        "--disable-warning=ExperimentalWarning",
        "--input-type=module",
        "-e",
        CHILD_SOURCE,
      ],
      cwd: os.tmpdir(),
      env: plainEnv(),
      timeoutMs: limitMs,
      signal: request.signal,
      outputMax: OUTPUT_MAX,
      ipc: {
        message: {
          base,
          runner: ACCEPTANCE_RUNNER_FILE,
          playwright: pathToFileURL(path.join(coreDir, "index.mjs")).href,
          files: {
            [ACCEPTANCE_RUNNER_FILE]: runAcceptanceSource,
            [ACCEPTANCE_HARNESS_FILE]: activityHarnessSource,
            [ACCEPTANCE_TEST_FILE]: request.test,
          },
          shim: fsShim(base, input),
        },
        onMessage: (message) => {
          const { type, text, failure: failed } = (message ?? {}) as Record<string, unknown>;
          if (type === "results" && typeof text === "string") sent.results = text;
          if (type === "done" && typeof failed === "string") sent.failure = failed;
        },
      },
    });
    if (run.outcome === "stopped") return stopped;
    if (run.outcome === "timed_out")
      return {
        ran: false,
        reason: `The acceptance tests ran past their time limit (${limitText(limitMs)}) and were stopped.`,
      };
    if (run.outcome !== "exited")
      return {
        ran: false,
        reason: clip(`The acceptance tests could not start: ${run.error ?? run.outcome}`),
      };
    if (run.code === 0 && sent.results !== null) return { ran: true, results: sent.results };
    return { ran: false, reason: clip(whyNotRun(run.stderr, sent.failure, run.code)) };
  } finally {
    await browser.close();
  }
}
