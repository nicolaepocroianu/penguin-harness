/**
 * Runs a check file — a case's hidden checks, or a trial's own tests — against a played module,
 * the way a test run does, but in the evaluator: its own Node process, its own browser, and the
 * harness and runner from the evaluator's checkout, never from the recipe's tree, so a
 * candidate cannot edit its grader. The files are served from memory by a module hook
 * (check-hooks.mjs): no check's text, and no hidden criterion, reaches the disk.
 */
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ACCEPTANCE_HARNESS_FILE,
  ACCEPTANCE_INPUT_FILE,
  ACCEPTANCE_RESULTS_FILE,
  ACCEPTANCE_RUNNER_FILE,
  ACCEPTANCE_TEST_FILE,
  HARNESS_VERSION,
  activityHarnessSource,
  runAcceptanceSource,
} from "../../packages/server/src/activities/acceptance-harness.js";
import { killTree, plainEnv, spawnTree } from "./process-tree.js";
import type { CheckRun, CheckRunner, HiddenChecks } from "./types.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The package whose `playwright-core` the harness drives. */
const SERVER_PACKAGE = path.resolve(HERE, "../../packages/server/package.json");

/** The fs module the harness and runner see: the input and the results never touch the disk. */
function fsShim(base: string, input: string): string {
  const inputUrl = JSON.stringify(`${base}${ACCEPTANCE_INPUT_FILE}`);
  const resultsUrl = JSON.stringify(`${base}${ACCEPTANCE_RESULTS_FILE}`);
  return `import fs from "node:fs";
const INPUT = ${inputUrl};
const RESULTS = ${resultsUrl};
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
export const { existsSync, readdirSync, statSync, mkdirSync, promises } = shim;
export const readFileSync = shim.readFileSync;
export const writeFileSync = shim.writeFileSync;
`;
}

/** Where Playwright's Chromium is, under `browsersDir` when given; null when not installed. */
export function findChromium(browsersDir?: string): Promise<string | null> {
  // In a child: Playwright reads PLAYWRIGHT_BROWSERS_PATH once, when it is first loaded.
  const script =
    "const { chromium } = require('module').createRequire(process.argv[1])('playwright-core');" +
    "process.stdout.write(String(chromium.executablePath() || ''));";
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["-e", script, SERVER_PACKAGE],
      {
        env: plainEnv(browsersDir ? { PLAYWRIGHT_BROWSERS_PATH: browsersDir } : {}),
        timeout: 30_000,
        windowsHide: true,
      },
      (error, stdout) => {
        const found = String(stdout).trim();
        resolve(!error && found && fs.existsSync(found) ? found : null);
      },
    );
  });
}

/** Runs check files in a child Node process, with the frozen harness, in the evaluator's browser. */
export class HarnessCheckRunner implements CheckRunner {
  readonly fingerprint: string;

  constructor(private readonly browserPath: string) {
    const hash = createHash("sha256").update(`harness ${HARNESS_VERSION}\n`);
    for (const source of [
      activityHarnessSource,
      runAcceptanceSource,
      fs.readFileSync(path.join(HERE, "check-child.mjs"), "utf8"),
      fs.readFileSync(path.join(HERE, "check-hooks.mjs"), "utf8"),
    ])
      hash.update(source).update("\0");
    this.fingerprint = hash.digest("hex").slice(0, 16);
  }

  run(checks: HiddenChecks, playUrl: string): Promise<CheckRun> {
    // A folder that never exists: the modules' URLs, so the harness finds its siblings.
    const base = `${pathToFileURL(path.join(os.tmpdir(), `penguin-bench-${randomBytes(8).toString("hex")}`)).href}/`;
    const input = JSON.stringify({
      playUrl,
      viewport: checks.viewport,
      criteria: checks.criteria,
      browserPath: this.browserPath,
      scenes: checks.scenes,
      specRevision: "bench",
    });
    const payload = {
      base,
      resolveFrom: pathToFileURL(SERVER_PACKAGE).href,
      files: {
        [ACCEPTANCE_RUNNER_FILE]: runAcceptanceSource,
        [ACCEPTANCE_HARNESS_FILE]: activityHarnessSource,
        [ACCEPTANCE_TEST_FILE]: checks.test,
      },
      shim: fsShim(base, input),
    };
    // The runner gives each check two minutes, three at a time.
    const limitMs = 120_000 * Math.ceil(Math.max(1, checks.criteria.length) / 3) + 120_000;
    const child = spawnTree(process.execPath, [path.join(HERE, "check-child.mjs")], {
      cwd: os.tmpdir(),
      env: plainEnv(),
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    let output = "";
    const keep = (chunk: Buffer) => {
      output = (output + chunk.toString("utf8")).slice(-8000);
    };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    let results: string | null = null;
    let failure: string | null = null;
    child.on("message", (message: { type?: string; text?: string; failure?: string | null }) => {
      if (message.type === "results" && typeof message.text === "string") results = message.text;
      if (message.type === "done" && message.failure) failure = message.failure;
    });
    return new Promise<CheckRun>((resolve) => {
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        void killTree(child);
      }, limitMs);
      child.once("spawn", () => child.send(payload));
      child.once("error", (error) => {
        clearTimeout(timer);
        resolve({ ran: false, reason: `The check runner did not start: ${error.message}` });
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        if (timedOut) return resolve({ ran: false, reason: "The checks took too long." });
        if (results !== null && code === 0) {
          try {
            const parsed = (JSON.parse(results) as { results?: unknown }).results;
            if (Array.isArray(parsed))
              return resolve({
                ran: true,
                results: parsed.map((entry: Record<string, unknown>) => ({
                  criterion: String(entry.criterion),
                  testName: String(entry.testName),
                  status: String(entry.status),
                  error: typeof entry.error === "string" ? entry.error : null,
                })),
              });
          } catch {
            // Fall through: unreadable results are no results.
          }
        }
        resolve({
          ran: false,
          reason: (failure ?? output.trim()) || `The check runner stopped (exit ${code}).`,
        });
      });
    });
  }
}

/**
 * Which criteria passed: those with a check, every one of which passed. A criterion with no
 * check, or one skipped, did not.
 */
export function passedCriteria(criteria: readonly string[], run: CheckRun): Set<string> {
  if (!run.ran) return new Set();
  return new Set(
    criteria.filter((criterion) => {
      const own = run.results.filter((result) => result.criterion === criterion);
      return own.length > 0 && own.every((result) => result.status === "passed");
    }),
  );
}
