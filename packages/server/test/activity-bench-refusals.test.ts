/**
 * When the activity bench refuses to answer, and what it spends first: nothing, for a dirty
 * checkout, a candidate outside the recipe surface, a host that is not ready, a busy bench
 * home or an estimate over the cap; and after a contaminated Trace, a second machinery fault,
 * a changed case set or the cap, it stops where it is — and the same comparison resumes.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CaseVault } from "../../../scripts/activity-bench/types.js";
import { PlainVault } from "../../../scripts/activity-bench/vault.js";
import {
  CANARY,
  PLACEHOLDER,
  benchFixture,
  parseTrial,
  removeTemps,
} from "./activity-bench-fixtures.js";

afterEach(removeTemps);

describe("before anything is spent", () => {
  it("refuses a checkout with changes that are not committed", async () => {
    const f = benchFixture();
    fs.writeFileSync(path.join(f.repo.dir, "notes.txt"), "draft\n");
    const verdict = await f.bench.compare({ head: f.head, base: f.base });
    expect(verdict).toMatchObject({ decision: "invalid", invalid: "dirty_tree" });
    expect(f.host.authored).toEqual([]);
  });

  it("refuses a candidate that changes anything outside the recipe surface", async () => {
    const f = benchFixture();
    const head = f.repo.commit(
      {
        "plugins/waf-authoring/skills/authoring/SKILL.md": "head again\n",
        "packages/server/src/collect.ts": "export const loosened = true;\n",
      },
      "a skill and a collector",
    );
    const verdict = await f.bench.compare({ head, base: f.base });
    expect(verdict).toMatchObject({
      decision: "invalid",
      invalid: "out_of_surface",
      reason: "head changes files outside the recipe surface: packages/server/src/collect.ts.",
    });
    expect(f.host.authored).toEqual([]);
    // A change to the surface alone is a comparison.
    expect((await f.bench.compare({ head: f.head, base: f.base })).decision).not.toBe("invalid");
  });

  it("refuses a revision that names no commit, and a host that is not ready", async () => {
    const f = benchFixture();
    expect(await f.bench.compare({ head: "no-such-branch", base: f.base })).toMatchObject({
      invalid: "preflight",
      reason: "no-such-branch names no commit.",
    });
    const refused = benchFixture({ refused: "The seed home has no test browser installed." });
    expect(await refused.bench.compare({ head: refused.head, base: refused.base })).toMatchObject({
      decision: "invalid",
      invalid: "preflight",
      reason: "The seed home has no test browser installed.",
    });
    expect(refused.host.authored).toEqual([]);
  });

  it("runs one evaluation at a time in a bench home", async () => {
    const f = benchFixture();
    fs.mkdirSync(f.home, { recursive: true });
    fs.writeFileSync(path.join(f.home, "bench.lock"), `${process.pid}\n`);
    expect(await f.bench.compare({ head: f.head, base: f.base })).toMatchObject({
      invalid: "busy",
    });
    // A lock its process left behind does not hold the home.
    fs.writeFileSync(path.join(f.home, "bench.lock"), "2147483646\n");
    expect((await f.bench.compare({ head: f.head, base: f.base })).decision).not.toBe("invalid");
    expect(fs.existsSync(path.join(f.home, "bench.lock"))).toBe(false);
  });

  it("refuses an estimate over the cap, or one nobody confirmed", async () => {
    const f = benchFixture({ trialEstimateUsd: 10 });
    const verdict = await f.bench.compare({ head: f.head, base: f.base });
    expect(verdict).toMatchObject({ decision: "invalid", invalid: "budget" });
    expect(verdict.reason).toContain("$180");
    expect(f.log.join("\n")).toContain("18 trials");
    expect(f.host.authored).toEqual([]);
    const asked: number[] = [];
    const unconfirmed = benchFixture({
      confirm: async (estimate) => {
        asked.push(estimate);
        return false;
      },
    });
    expect(
      await unconfirmed.bench.compare({ head: unconfirmed.head, base: unconfirmed.base }),
    ).toMatchObject({ invalid: "budget" });
    expect(asked).toEqual([18]);
    expect(unconfirmed.host.authored).toEqual([]);
  });
});

describe("once trials run", () => {
  it("stops at the cap measured trials reach, and resumes where it stopped", async () => {
    const f = benchFixture({
      script: () => ({ costUsd: 4 }),
      passed: (trial) => (trial.side === "head" ? 4 : 2),
    });
    const stopped = await f.bench.compare({ head: f.head, base: f.base, maxCostUsd: 30 });
    expect(stopped).toMatchObject({
      decision: "invalid",
      invalid: "budget",
      costUsd: { spent: 24 },
    });
    expect(f.host.authored).toHaveLength(6);
    const resumed = await f.bench.compare({ head: f.head, base: f.base, maxCostUsd: 100 });
    expect(resumed).toMatchObject({ decision: "better", costUsd: { spent: 72 } });
    expect(resumed.evaluation).toBe(stopped.evaluation);
    // Only the trials not yet done were run.
    expect(f.host.authored).toHaveLength(18);
    expect(new Set(f.host.authored).size).toBe(18);
    // Asked again, the finished comparison answers as it did.
    expect(await f.bench.compare({ head: f.head, base: f.base })).toEqual(resumed);
    expect(f.host.authored).toHaveLength(18);
  });

  it("voids the evaluation for good when a graded Trace holds the canary", async () => {
    const f = benchFixture({
      script: (trial) => {
        const { caseId, trial: n, side } = parseTrial(trial.id);
        return caseId.startsWith("CASE-002") && n === 1 && side === "head"
          ? { trace: `{"text":"found ${CANARY.toLowerCase()} in a file"}\n` }
          : {};
      },
    });
    const verdict = await f.bench.compare({ head: f.head, base: f.base });
    expect(verdict).toMatchObject({ decision: "invalid", invalid: "contaminated" });
    const authored = f.host.authored.length;
    // That block's hidden checks were never unsealed: nothing of it was scored.
    expect(
      f.checks.calls.some((call) => call.includes("CASE-002-placeholder-count-the-apples/1/")),
    ).toBe(false);
    expect(await f.bench.compare({ head: f.head, base: f.base })).toMatchObject({
      invalid: "contaminated",
    });
    expect(f.host.authored).toHaveLength(authored);
  });

  it("treats the vault's path in a Trace, as JSON writes it, as contamination", async () => {
    const escaped = JSON.stringify(path.resolve(PLACEHOLDER)).slice(1, -1);
    const f = benchFixture({
      script: (trial) =>
        parseTrial(trial.id).trial === 0 ? { trace: `{"path":"${escaped}"}\n` } : {},
    });
    expect(await f.bench.compare({ head: f.head, base: f.base })).toMatchObject({
      invalid: "contaminated",
    });
  });

  it("retries a machinery fault once and scores the retry, never zero", async () => {
    const f = benchFixture({
      script: (trial) => (parseTrial(trial.id).trial === 1 ? { infraFaults: 1 } : {}),
      passed: (trial) => (trial.side === "head" ? 4 : 2),
    });
    const verdict = await f.bench.compare({ head: f.head, base: f.base });
    expect(verdict.decision).toBe("better");
    expect(verdict.dev.cases.every((item) => item.base === 50 && item.head === 100)).toBe(true);
    expect(f.host.authored).toHaveLength(24);
    expect(f.log.some((line) => line.startsWith("A machinery fault, retrying once"))).toBe(true);
  });

  it("stops after a second machinery fault, and carries on once the machinery works", async () => {
    let broken = true;
    const f = benchFixture({
      script: (trial) =>
        broken && parseTrial(trial.id).caseId.startsWith("CASE-002") ? { infraFaults: 99 } : {},
    });
    const stopped = await f.bench.compare({ head: f.head, base: f.base });
    expect(stopped).toMatchObject({ decision: "invalid", invalid: "infrastructure" });
    expect(stopped.reason).toMatch(/^Scripted fault 2 of /);
    broken = false;
    const resumed = await f.bench.compare({ head: f.head, base: f.base });
    expect(resumed.decision).not.toBe("invalid");
    expect(resumed.evaluation).toBe(stopped.evaluation);
  });

  it("stops when hidden checks cannot run twice: a fault of the evaluator, not a zero", async () => {
    let failures = 0;
    const f = benchFixture({
      passed: (trial, own) => {
        if (!own && trial.caseId.startsWith("CASE-001") && trial.trial === 0 && failures < 2) {
          failures++;
          return null;
        }
        return 2;
      },
    });
    expect(await f.bench.compare({ head: f.head, base: f.base })).toMatchObject({
      invalid: "infrastructure",
    });
    expect(failures).toBe(2);
  });

  it("removes a held-out home it could not score, and runs that trial again on resume", async () => {
    const heldOut = "CASE-003-placeholder-held-out-match-the-sound";
    let broken = true;
    const f = benchFixture({
      passed: (trial, own) =>
        broken && !own && trial.caseId === heldOut && trial.trial === 0 ? null : 2,
    });
    expect(await f.bench.compare({ head: f.head, base: f.base })).toMatchObject({
      invalid: "infrastructure",
    });
    const stopped = f.host.authored.filter((id) => parseTrial(id).caseId === heldOut);
    expect(stopped).toHaveLength(2);
    expect([...f.host.discarded].sort()).toEqual([...stopped].sort());
    broken = false;
    expect((await f.bench.compare({ head: f.head, base: f.base })).decision).not.toBe("invalid");
    expect(f.host.authored.filter((id) => stopped.includes(id))).toHaveLength(4);
  });

  it("stops when the case set changes under it", async () => {
    const plain = new PlainVault(PLACEHOLDER);
    let reads = 0;
    const vault: CaseVault = {
      sealed: false,
      describe: async () => {
        const set = await plain.describe();
        return reads++ < 2 ? set : { ...set, revision: "changed" };
      },
      request: (caseId) => plain.request(caseId),
      hidden: (caseId) => plain.hidden(caseId),
      tripwires: () => plain.tripwires(),
    };
    const f = benchFixture({ vault });
    expect(await f.bench.compare({ head: f.head, base: f.base })).toMatchObject({
      invalid: "bench_changed",
    });
    expect(f.host.authored).toHaveLength(2);
  });
});
