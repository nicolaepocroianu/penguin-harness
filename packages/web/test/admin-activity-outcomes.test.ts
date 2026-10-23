/**
 * activity-outcomes-model.ts: what the Activity outcomes page offers and how a tally of the
 * outcome ledger reads as a row. The page itself only reads the ledger's admin routes through the
 * typed client; its flow is covered by the activities e2e.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { OutcomeTally, RunRecipe } from "@waterford/waf-harness-server/api";
import {
  OUTCOME_KINDS,
  factDetail,
  outcomeRow,
  recipeParts,
  shortKey,
  windowSince,
} from "../src/features/admin/activity-outcomes-model";

const recipe: RunRecipe = {
  runtime: "agent:custom/m",
  library: [
    {
      plugin: "waf-authoring",
      version: "2026.10.01.1",
      skills: [{ name: "waf-state-machine", version: "2026.09.01.1", sha256: "a".repeat(64) }],
    },
  ],
  harness: 2,
  wafh: "0.2.13",
};

describe("the run kinds offered", () => {
  it("offers every kind a run records, once each, the specification first", () => {
    expect(OUTCOME_KINDS).toHaveLength(15);
    expect(new Set(OUTCOME_KINDS).size).toBe(15);
    expect(OUTCOME_KINDS[0]).toBe("spec");
    expect(OUTCOME_KINDS).toEqual(expect.arrayContaining(["module", "test", "quality", "assist"]));
  });
});

describe("the window a tally reads", () => {
  const now = new Date("2026-10-13T12:00:00.000Z");

  it("counts back whole days from now, and reads all time without a start", () => {
    expect(windowSince("7d", now)).toBe("2026-10-06T12:00:00.000Z");
    expect(windowSince("30d", now)).toBe("2026-09-13T12:00:00.000Z");
    expect(windowSince("90d", now)).toBe("2026-07-15T12:00:00.000Z");
    expect(windowSince("all", now)).toBeUndefined();
  });
});

describe("a tally as a row", () => {
  const tally = (metrics: Record<string, number>, runs = 4): OutcomeTally => ({
    key: "k",
    recipe,
    runs,
    metrics,
  });

  it("reads what became of the runs from the ledger's metrics", () => {
    expect(
      outcomeRow(
        tally({
          succeeded: 3,
          failed: 1,
          repairable: 1,
          accepted: 2,
          "accepted.author": 2,
          "edits.author": 2,
          "edits.stages": 1,
          "edits.run": 1,
          reverted: 1,
          replaced: 1,
          "deployed.qa": 2,
          "deployed.prod": 1,
          "tests.untrusted": 1,
          "playerCheck.untrusted": 1,
          "judged.tests.untrusted": 5,
        }),
      ),
    ).toEqual({
      runs: 4,
      succeeded: 3,
      successPercent: 75,
      repaired: 1,
      accepted: 2,
      edits: 4,
      reverted: 1,
      deployedQa: 2,
      deployedProd: 1,
      // A later test that judged a build untrusted is not the build's own check.
      untrusted: 2,
    });
  });

  it("counts nothing it was not given, and no share of no runs", () => {
    expect(outcomeRow(tally({}, 0))).toMatchObject({
      runs: 0,
      succeeded: 0,
      successPercent: 0,
      edits: 0,
      untrusted: 0,
    });
    expect(outcomeRow(tally({ succeeded: 1 }, 3)).successPercent).toBe(33);
  });
});

describe("naming a recipe and its facts", () => {
  it("names a recipe by who answered, its WAF Harness, its skills and its harness", () => {
    expect(recipeParts(recipe)).toEqual({
      runtime: "agent:custom/m",
      wafh: "0.2.13",
      libraries: ["waf-authoring 2026.10.01.1"],
      harness: 2,
    });
    expect(recipeParts({ runtime: "server", library: [], wafh: "1" }).harness).toBeNull();
  });

  it("shortens a digest and leaves any other key as it is", () => {
    expect(shortKey("0123456789abcdef".repeat(4))).toBe("0123456789ab");
    expect(shortKey("agent:custom/m")).toBe("agent:custom/m");
    expect(shortKey("2")).toBe("2");
  });

  it("reads a fact's detail as one line, nested names joined and digests shortened", () => {
    expect(
      factDetail({
        runtime: "agent:custom/m",
        prompt: "f".repeat(64),
        status: "succeeded",
        checks: { "tests.passed": 2 },
        judges: ["run_a", "run_b"],
      }),
    ).toBe(
      "runtime: agent:custom/m · prompt: ffffffffffff · status: succeeded · checks.tests.passed: 2 · judges: run_a, run_b",
    );
    expect(factDetail({})).toBe("");
  });
});

describe("the page reads through the typed client", () => {
  it("asks the ledger's routes by their endpoints, never with a raw fetch", () => {
    const source = readFileSync(
      new URL("../src/features/admin/activity-outcomes-section.tsx", import.meta.url),
      "utf8",
    );
    for (const call of [
      "adminOutcomeTally",
      "adminOutcomeRuns",
      "adminOutcomeHistory",
      "adminOutcomeProjects",
    ])
      expect(source).toContain(`api.${call}(`);
    expect(source).not.toMatch(/apiFetch|fetch\(/);
  });
});
