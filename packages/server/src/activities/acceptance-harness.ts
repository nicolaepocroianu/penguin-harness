/**
 * The files an acceptance test run is given, and what its agent is asked to do.
 *
 * A test run's workspace holds, beside the activity's own inputs:
 *   acceptance-input.json   what to test and where: the signed play link, the viewport, the
 *                           criteria, the test browser's executable, the scene ids, and for a
 *                           confined run the browser server WAF Harness started for it
 *   activity-harness.mjs    WAF Harness's harness API over `playwright-core`, the only thing the
 *                           agent's tests may use to drive the player
 *   run-acceptance.mjs      starts the test browser (or connects to that server), runs the
 *                           agent's `acceptance.test.mjs`
 *                           criterion by criterion, and writes `acceptance-results.json`
 *   package.json            pins `playwright-core` to the version this server drives
 *
 * The harness talks to the player through the inspection bridge a WAF module exposes
 * (`window.Activity.Inspection`: its current state, the states and media it went through, and
 * its tap targets), and taps, holds and drags like a learner would. Neither script prints the
 * environment or any request's headers.
 *
 * Tests an earlier run wrote for the same criteria are not handed to an agent again: the server
 * runs them itself, with these same sources from memory (confined-checks.ts, decision 17).
 *
 * Raise `HARNESS_VERSION` whenever the harness API changes, so tests written against an older
 * one are written again rather than reused.
 */

import path from "node:path";
import { readArtifactBytes } from "./artifact.js";
import { testFileHash } from "./acceptance-collect.js";
import { PLAYER_BROWSER_ARGS } from "./browser-session.js";
import { ACCEPTANCE_PROMPT, HARNESS_API as harnessApi } from "./prompts/test.js";

export const HARNESS_VERSION = 2;

export const ACCEPTANCE_INPUT_FILE = "acceptance-input.json";
export const ACCEPTANCE_HARNESS_FILE = "activity-harness.mjs";
export const ACCEPTANCE_RUNNER_FILE = "run-acceptance.mjs";
export const ACCEPTANCE_TEST_FILE = "acceptance.test.mjs";
export const ACCEPTANCE_RESULTS_FILE = "acceptance-results.json";
/** Where a run's report goes, inside its workspace. */
export const ACCEPTANCE_REPORT_DIR = "reports";
export const ACCEPTANCE_REPORT_FILE = "test.json";
/** The most bytes an earlier run's test file may have to be reused. */
export const TEST_FILE_MAX_BYTES = 256 * 1024;

/**
 * The files the server stages for a run's checks, a test run's or a module run's player check,
 * which the run must leave as they are: the harness, the runner, the input, and the package.json
 * pinning playwright-core (what npm installs from it is the run's own, and not compared).
 */
export const CHECK_FILES = [
  ACCEPTANCE_HARNESS_FILE,
  ACCEPTANCE_RUNNER_FILE,
  ACCEPTANCE_INPUT_FILE,
  "package.json",
] as const;

/** The SHA-256 of each check file in `dir` as it is now, by name; a missing file has none. */
export async function checkFileDigests(dir: string): Promise<Record<string, string>> {
  const digests: Record<string, string> = {};
  for (const name of CHECK_FILES) {
    const bytes = await readArtifactBytes(path.join(dir, name), TEST_FILE_MAX_BYTES).catch(
      () => null,
    );
    if (bytes) digests[name] = testFileHash(bytes);
  }
  return digests;
}

/** Whether a check file in `dir` is not as `staged` records it: changed, gone, or new. */
export async function checkFilesChanged(
  dir: string,
  staged: Readonly<Record<string, string>>,
): Promise<boolean> {
  const now = await checkFileDigests(dir);
  return CHECK_FILES.some((name) => now[name] !== staged[name]);
}

export const activityHarnessSource = `// WAF Harness's acceptance harness: drive the played activity in the test browser.
// Tests import only from this file. Do not edit it.
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";

const input = JSON.parse(
  fs.readFileSync(new URL("./${ACCEPTANCE_INPUT_FILE}", import.meta.url), "utf8"),
);

/** The acceptance criteria, in the specification's order. Pass each one to criterion() as it is. */
export const criteria = Object.freeze([...input.criteria]);
/** The specification's scene ids, in order. */
export const scenes = Object.freeze([...input.scenes]);

export const DEFAULT_TIMEOUT_MS = 15000;

const registered = [];
const open = new Set();
/** The activities the check running in this async context opened, so each check closes its own. */
const checkScope = new AsyncLocalStorage();
let browser = null;

/**
 * Registers the check for one acceptance criterion: criterion(text, fn) or
 * criterion(text, testName, fn). \`text\` is the criterion exactly as listed in \`criteria\`.
 * The check passes when fn resolves and fails with the message of what it throws.
 */
export function criterion(text, testName, fn) {
  if (typeof testName === "function") {
    fn = testName;
    testName = text;
  }
  if (typeof text !== "string" || typeof fn !== "function")
    throw new TypeError("Use criterion(text, fn) or criterion(text, testName, fn).");
  registered.push({ criterion: text, testName: String(testName), fn });
}

class Skipped extends Error {}

/** Ends a check as skipped: only for a criterion the player cannot show, such as art style. */
export function skip(reason) {
  throw new Skipped(String(reason || "Skipped."));
}

/** Fails the check with \`message\` unless \`condition\` holds. */
export function expect(condition, message) {
  if (!condition) throw new Error(message || "Expectation failed.");
}

const READY =
  "!!(window.Activity && window.Activity.Inspection && typeof window.Activity.Inspection.getSnapshot === 'function')";

function selectorFor(id) {
  const quoted = JSON.stringify(String(id));
  return "[data-interactable-id=" + quoted + "], [id=" + quoted + "]";
}

class Activity {
  constructor(page, context) {
    /** The Playwright page, for reading what is on screen; drive the player with the methods below. */
    this.page = page;
    this.context = context;
  }

  async ready(timeoutMs = DEFAULT_TIMEOUT_MS) {
    try {
      await this.page.waitForFunction(READY, undefined, { timeout: timeoutMs });
    } catch {
      throw new Error("The activity did not expose window.Activity.Inspection; it may not have started.");
    }
    const pause = this.page.locator("#pauseOverlay").first();
    if (await pause.isVisible().catch(() => false)) {
      await pause.click();
      await pause.waitFor({ state: "hidden", timeout: timeoutMs });
    }
  }

  /**
   * Pauses the activity as a learner's pause key does (the player's Shift+P), and waits until
   * the framework's pause overlay shows.
   */
  async pause(timeoutMs = DEFAULT_TIMEOUT_MS) {
    await this.page.keyboard.press("Shift+P");
    await this.page.locator("#pauseOverlay").first().waitFor({ state: "visible", timeout: timeoutMs });
  }

  /** Resumes a paused activity with the same key, and waits until the pause overlay is gone. */
  async resume(timeoutMs = DEFAULT_TIMEOUT_MS) {
    await this.page.keyboard.press("Shift+P");
    await this.page.locator("#pauseOverlay").first().waitFor({ state: "hidden", timeout: timeoutMs });
  }

  /** The current state: { state, sceneId, phase, index, interactive }. */
  state() {
    return this.page.evaluate(() => window.Activity.Inspection.getSnapshot());
  }

  /** Every state entered so far, oldest first: [{ state, sceneId, phase, index, details }]. */
  history() {
    return this.page.evaluate(() => window.Activity.Inspection.getHistory());
  }

  /** Every media event so far, oldest first: [{ kind, key, status, state, index }]. */
  mediaHistory() {
    return this.page.evaluate(() => window.Activity.Inspection.getMediaHistory());
  }

  /** Waits until the activity enters state \`name\` (after state index \`afterIndex\`); the state record. */
  waitForState(name, { timeoutMs = DEFAULT_TIMEOUT_MS, afterIndex = -1 } = {}) {
    return this.page.evaluate(
      (request) =>
        window.Activity.Inspection.waitForState(request.name, {
          timeoutMs: request.timeoutMs,
          afterIndex: request.afterIndex,
        }),
      { name, timeoutMs, afterIndex },
    );
  }

  /**
   * Waits until media \`key\` reaches \`status\` (started, completed, interrupted, failed or
   * unavailable; completed by default) — audio unless \`kind\` says video.
   */
  waitForMedia(
    key,
    { kind = "audio", status = "completed", timeoutMs = DEFAULT_TIMEOUT_MS, afterIndex = -1 } = {},
  ) {
    return this.page.evaluate(
      (request) =>
        window.Activity.Inspection.waitForMedia(request.kind, request.key, request.status, {
          timeoutMs: request.timeoutMs,
          afterIndex: request.afterIndex,
        }),
      { key, kind, status, timeoutMs, afterIndex },
    );
  }

  /** What can be tapped now: [{ id, inputType, event?, description? }]. */
  interactables() {
    return this.page.evaluate(() => {
      const inspection = window.Activity && window.Activity.Inspection;
      try {
        return (inspection && inspection.getCurrentState().interactables) || [];
      } catch {
        return [];
      }
    });
  }

  /** Waits until tap target \`id\` is armed. */
  async waitForInteractable(id, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = (await this.interactables()).find((entry) => entry && entry.id === id);
      if (found) return found;
      if (Date.now() >= deadline) throw new Error("Tap target " + JSON.stringify(id) + " never became available.");
      await this.page.waitForTimeout(100);
    }
  }

  async centre(id) {
    await this.waitForInteractable(id);
    const target = this.page.locator(selectorFor(id)).first();
    await target.waitFor({ state: "visible" });
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (!box) throw new Error("Tap target " + JSON.stringify(id) + " has no visible box.");
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  /** Taps target \`id\` once it is armed. */
  async tap(id) {
    const { x, y } = await this.centre(id);
    await this.page.mouse.click(x, y);
  }

  /** Presses and holds target \`id\` for \`ms\` milliseconds. */
  async hold(id, ms = 1200) {
    const { x, y } = await this.centre(id);
    await this.page.mouse.move(x, y);
    await this.page.mouse.down();
    try {
      await this.page.waitForTimeout(ms);
    } finally {
      await this.page.mouse.up();
    }
  }

  /** Drags target \`id\` onto target \`toId\`. */
  async drag(id, toId) {
    const from = await this.centre(id);
    const to = await this.centre(toId);
    await this.page.mouse.move(from.x, from.y);
    await this.page.mouse.down();
    await this.page.mouse.move(to.x, to.y, { steps: 12 });
    await this.page.mouse.up();
  }

  async close() {
    open.delete(this);
    checkScope.getStore()?.delete(this);
    await this.context.close().catch(() => {});
  }
}

/** Opens the played activity, on \`scene\` when given, and waits for it to start. */
export async function openActivity({ url = input.playUrl, viewport = input.viewport, scene, language } = {}) {
  if (!browser) throw new Error("The test browser is not running. Run the tests with node ${ACCEPTANCE_RUNNER_FILE}.");
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
  const activity = new Activity(page, context);
  open.add(activity);
  checkScope.getStore()?.add(activity);
  const target = new URL(url);
  if (scene) target.searchParams.set("scene", scene);
  if (language) target.searchParams.set("language", language);
  await page.goto(target.toString(), { waitUntil: "load" });
  await activity.ready();
  return activity;
}

// For run-acceptance.mjs only.
export const runner = {
  attach(value) {
    browser = value;
  },
  registered: () => [...registered],
  isSkip: (error) => error instanceof Skipped,
  /** Runs one check, then closes the activities it opened, whatever other checks are doing. */
  run(fn) {
    const owned = new Set();
    return checkScope.run(owned, async () => {
      try {
        return await fn();
      } finally {
        for (const activity of [...owned]) await activity.close();
      }
    });
  },
  async closeAll() {
    for (const activity of [...open]) await activity.close();
  },
};
`;

export const runAcceptanceSource = `// Runs acceptance.test.mjs against the played activity and writes ${ACCEPTANCE_RESULTS_FILE}.
// Do not edit it.
import fs from "node:fs";
import { chromium } from "playwright-core";
import { runner } from "./activity-harness.mjs";

const input = JSON.parse(
  fs.readFileSync(new URL("./${ACCEPTANCE_INPUT_FILE}", import.meta.url), "utf8"),
);
const CHECK_TIMEOUT_MS = 120000;
/**
 * Checks run side by side, each in its own browser context: they play media in real time, so
 * one after another they took minutes. Few enough that a slow machine keeps its timing.
 */
const PARALLEL_CHECKS = 3;

function withTimeout(promise) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("The check took longer than two minutes.")), CHECK_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

// What went wrong, without the stack's "at ..." lines.
const message = (error) =>
  (error && error.message ? error.message : String(error))
    .split("\\n")
    .filter((line) => !/^\\s+at /.test(line))
    .join("\\n")
    .trim();

let browser;
try {
  // A confined run's server started the browser (its commands cannot): connect to it. For a
  // connected browser close() only disconnects, so the checks can be run again.
  browser = input.browserEndpoint
    ? await chromium.connect(input.browserEndpoint)
    : await chromium.launch({
        executablePath: input.browserPath,
        headless: true,
        args: ${JSON.stringify(PLAYER_BROWSER_ARGS)},
      });
  runner.attach(browser);
  await import("./${ACCEPTANCE_TEST_FILE}");
} catch (error) {
  console.error("The acceptance tests could not run: " + message(error));
  if (browser) await browser.close().catch(() => {});
  process.exit(1);
}

const entries = runner.registered();
// In registration order, however the checks finish.
const results = new Array(entries.length);
let next = 0;
async function worker() {
  while (next < entries.length) {
    const index = next++;
    const entry = entries[index];
    const started = performance.now();
    let status = "passed";
    let error = null;
    try {
      // Timed inside the check's scope: a check that runs out of time has its pages closed
      // then, rather than playing on beside the next one.
      await runner.run(() => withTimeout(Promise.resolve().then(() => entry.fn())));
    } catch (caught) {
      status = runner.isSkip(caught) ? "skipped" : "failed";
      error = message(caught).slice(0, 2000);
    }
    const durationMs = Math.max(0, Math.round(performance.now() - started));
    results[index] = { criterion: entry.criterion, testName: entry.testName, status, durationMs, error };
    console.log(status.toUpperCase() + "  " + entry.testName + (error ? "  - " + error : ""));
  }
}
await Promise.all(Array.from({ length: Math.min(PARALLEL_CHECKS, entries.length) }, worker));
await runner.closeAll();
await browser.close().catch(() => {});
fs.writeFileSync(
  new URL("./${ACCEPTANCE_RESULTS_FILE}", import.meta.url),
  JSON.stringify({ results }, null, 2),
);
const covered = new Set(results.map((result) => result.criterion));
const missing = input.criteria.filter((text) => !covered.has(text));
console.log(results.length + " checks ran; " + missing.length + " criteria have no check.");
`;

/**
 * The harness's API, as a test run and a module run's player check are told it: its text is in
 * prompts/test.ts.
 */
export const HARNESS_API = harnessApi({
  ACCEPTANCE_HARNESS_FILE,
  PLAYER_BROWSER_ARGS: PLAYER_BROWSER_ARGS.join(" "),
});

/** The acceptance prompt: its text is in prompts/test.ts. */
export const acceptancePrompt = ACCEPTANCE_PROMPT({
  ACCEPTANCE_HARNESS_FILE,
  ACCEPTANCE_INPUT_FILE,
  ACCEPTANCE_RESULTS_FILE,
  ACCEPTANCE_RUNNER_FILE,
  ACCEPTANCE_TEST_FILE,
  PLAYER_BROWSER_ARGS: PLAYER_BROWSER_ARGS.join(" "),
});
