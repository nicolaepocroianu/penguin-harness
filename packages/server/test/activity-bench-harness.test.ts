/**
 * The evaluator's check runner against a real module page, in a real browser: a fixture module
 * that answers the inspection bridge as a WAF module does, a placeholder case's hidden checks,
 * and the frozen harness and runner from this checkout served from memory. Sealing's proofs
 * run the same way: every check fails on an empty page and passes on the gold module.
 * Skipped where Playwright's Chromium is not installed.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import {
  HarnessCheckRunner,
  findChromium,
  passedCriteria,
} from "../../../scripts/activity-bench/checks.js";
import { proveCase, serveFolder } from "../../../scripts/activity-bench/seal.js";
import { PlainVault } from "../../../scripts/activity-bench/vault.js";
import { PLACEHOLDER, removeTemps, tempDir } from "./activity-bench-fixtures.js";

const STAR = "CASE-001-placeholder-tap-the-star";

/** A module page that plays the star case: one tap target, narration, then the end. */
const FIXTURE_MODULE = `<!doctype html>
<html><body>
<button id="star" data-interactable-id="star"
  style="position:absolute;left:80px;top:80px;width:120px;height:120px">Star</button>
<script>
  const history = [];
  const media = [{ kind: "audio", key: "narration_intro", status: "started", state: "intro", index: 0 }];
  let current = null;
  function enter(state) {
    current = { state, sceneId: "sky", phase: state, index: history.length, interactive: state === "intro" };
    history.push({ ...current, details: {} });
  }
  enter("intro");
  document.getElementById("star").addEventListener("click", () => {
    if (current.state === "intro") enter("end");
  });
  window.Activity = {
    Inspection: {
      getSnapshot: () => ({ ...current }),
      getHistory: () => history.map((entry) => ({ ...entry })),
      getMediaHistory: () => media.slice(),
      getCurrentState: () => ({
        interactables: current.state === "intro" ? [{ id: "star", inputType: "tap", description: "the star" }] : [],
      }),
      waitForState: async (name, { timeoutMs = 5000, afterIndex = -1 } = {}) => {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
          const found = history.find((entry) => entry.index > afterIndex && (name === "*" || entry.state === name));
          if (found) return found;
          if (Date.now() > deadline) throw new Error("No state " + name);
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      },
      waitForMedia: async () => media[0],
    },
  };
</script>
</body></html>
`;

const executable = (() => {
  try {
    const file = chromium.executablePath();
    return file && fs.existsSync(file) ? file : null;
  } catch {
    return null;
  }
})();

afterEach(removeTemps);

function moduleFolder(html = FIXTURE_MODULE): string {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "index.html"), html);
  return dir;
}

/** Folders the runner would have made if it wrote its files to disk. */
function virtualFolders(): string[] {
  return fs.readdirSync(os.tmpdir()).filter((name) => /^penguin-bench-[0-9a-f]{16}$/.test(name));
}

describe.skipIf(!executable)("the evaluator's check runner, in a real browser", () => {
  it("finds the browser the harness drives", async () => {
    expect(await findChromium()).toBeTruthy();
  }, 60_000);

  it("runs a case's hidden checks against a played module with the frozen harness", async () => {
    const checks = new HarnessCheckRunner(executable!);
    const hidden = await new PlainVault(PLACEHOLDER).hidden(STAR);
    const before = virtualFolders();
    const page = await serveFolder(moduleFolder());
    try {
      const run = await checks.run(hidden, page.url);
      expect(run.ran).toBe(true);
      expect([...passedCriteria(hidden.criteria, run)]).toEqual(hidden.criteria);
      // Served from memory: nothing of the checks reached the disk.
      expect(virtualFolders()).toEqual(before);
    } finally {
      await page.close();
    }
    // A broken module fails the checks that reach what broke, and the run still reports them.
    const broken = await serveFolder(moduleFolder(FIXTURE_MODULE.replace('enter("end")', "")));
    try {
      const run = await checks.run(hidden, broken.url);
      const passed = passedCriteria(hidden.criteria, run);
      expect(passed.has(hidden.criteria[0]!)).toBe(true);
      expect(passed.has(hidden.criteria[2]!)).toBe(false);
    } finally {
      await broken.close();
    }
  }, 120_000);

  it("lets a check import only the harness and Node's own modules", async () => {
    const checks = new HarnessCheckRunner(executable!);
    const page = await serveFolder(moduleFolder());
    try {
      const run = await checks.run(
        {
          test: 'import "./elsewhere.mjs";\n',
          criteria: ["Anything."],
          scenes: [],
          viewport: { width: 800, height: 600 },
        },
        page.url,
      );
      expect(run).toMatchObject({ ran: false });
      expect(!run.ran && run.reason).toContain("A check may import only the harness");
    } finally {
      await page.close();
    }
  }, 60_000);

  it("proves a case before it is sealed: every check fails on nothing and passes on its gold module", async () => {
    const checks = new HarnessCheckRunner(executable!);
    const dir = tempDir();
    fs.cpSync(PLACEHOLDER, dir, { recursive: true });
    const gold = path.join(dir, STAR, "gold");
    fs.mkdirSync(gold);
    fs.writeFileSync(path.join(gold, "index.html"), FIXTURE_MODULE);
    // Each check waits for the empty page to start before it fails: this takes half a minute.
    expect(await proveCase(new PlainVault(dir), STAR, checks)).toBeNull();
  }, 180_000);
});
