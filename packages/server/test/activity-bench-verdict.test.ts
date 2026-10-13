/**
 * The activity bench's verdict: the noise-aware rule (paired bootstrap, measured noise,
 * guardrails, the Claude Code non-regression check), and a comparison taken end to end
 * through the ScriptedHost and the placeholder cases — interleaved blocks, hidden checks
 * unsealed only after the block's Traces were scanned, own tests re-run before them, held-out
 * homes removed once scored.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  decide,
  minDetectable,
  noiseSd,
  pairedBootstrap,
} from "../../../scripts/activity-bench/stats.js";
import type { CaseVault } from "../../../scripts/activity-bench/types.js";
import { PlainVault } from "../../../scripts/activity-bench/vault.js";
import {
  OWN_TESTS,
  PLACEHOLDER,
  benchFixture,
  parseTrial,
  removeTemps,
} from "./activity-bench-fixtures.js";

const DEV = ["CASE-001-placeholder-tap-the-star", "CASE-002-placeholder-count-the-apples"];
const HELD_OUT = "CASE-003-placeholder-held-out-match-the-sound";

afterEach(removeTemps);

describe("the noise-aware rule", () => {
  it("pairs each case's trials and resamples cases and trials reproducibly", () => {
    const cases = [
      { weight: 1, diffs: [10, 20, 30] },
      { weight: 1, diffs: [0, 10, 20] },
    ];
    const first = pairedBootstrap(cases, "seed");
    expect(first).toEqual(pairedBootstrap(cases, "seed"));
    expect(first.delta).toBe(15);
    expect(first.ci90[0]).toBeLessThan(15);
    expect(first.ci90[1]).toBeGreaterThan(15);
    expect(pairedBootstrap([{ weight: 1, diffs: [25, 25] }], "seed")).toEqual({
      delta: 25,
      ci90: [25, 25],
    });
    expect(pairedBootstrap([], "seed")).toEqual({ delta: 0, ci90: [0, 0] });
  });

  it("weighs cases by their weight", () => {
    const { delta } = pairedBootstrap(
      [
        { weight: 3, diffs: [10] },
        { weight: 1, diffs: [-10] },
      ],
      "seed",
    );
    expect(delta).toBe(5);
  });

  it("measures noise within cells, and never counts a rise under two points", () => {
    // Pooled: (0 × 2 + 5000 × 1) / 3, a cell of one adds nothing.
    expect(noiseSd([[50, 50, 50], [0, 100], [75]])).toBe(40.82);
    expect(
      minDetectable(
        [
          { weight: 1, diffs: [10, 10] },
          { weight: 1, diffs: [10, 10] },
        ],
        0,
      ),
    ).toBe(2);
    expect(
      minDetectable(
        [
          { weight: 1, diffs: [0] },
          { weight: 1, diffs: [20] },
        ],
        0,
      ),
    ).toBe(20);
  });

  it("is better only when dev rises past the noise and nothing else falls", () => {
    const flat = { delta: 0, ci90: [-1, 1] as [number, number] };
    const up = { delta: 10, ci90: [4, 16] as [number, number] };
    const down = { delta: -10, ci90: [-16, -4] as [number, number] };
    const base = { dev: up, heldOut: flat, nonRegression: null, minDetectable: 2, worse: [] };
    expect(decide(base)).toBe("better");
    expect(decide({ ...base, minDetectable: 12 })).toBe("inconclusive");
    expect(decide({ ...base, dev: { delta: 3, ci90: [-1, 7] } })).toBe("inconclusive");
    expect(decide({ ...base, worse: ["selfGradingGap"] })).toBe("inconclusive");
    expect(decide({ ...base, heldOut: down })).toBe("worse");
    expect(decide({ ...base, heldOut: { delta: -3, ci90: [-9, 2] } })).toBe("inconclusive");
    expect(decide({ ...base, nonRegression: { ci90: [-9, -1] } })).toBe("worse");
    expect(decide({ ...base, dev: down })).toBe("worse");
  });
});

describe("a comparison through the scripted host", () => {
  it("finds head better when it passes more hidden checks on the dev cases", async () => {
    const f = benchFixture({
      passed: (trial) => (trial.caseId === HELD_OUT ? 3 : trial.side === "head" ? 4 : 2),
    });
    const verdict = await f.bench.compare({ head: f.head, base: f.base });
    expect(verdict).toMatchObject({
      decision: "better",
      head: {
        sha: f.head,
        testAgent: "activity_agent",
        runtime: "default",
        answeredBy: "agent:scripted/model",
      },
      base: { sha: f.base },
      dev: { delta: 50, ci90: [50, 50] },
      heldOut: { delta: 0, ci90: [0, 0] },
      guardrails: { selfGradingGap: [0, 0], costPerTrial: [1, 1], worse: [] },
      nonRegression: {
        runtime: "coding:claude",
        skipped: "Claude Code is not set up for this bench.",
      },
      noiseSd: 0,
      minDetectable: 2,
      costUsd: { head: 9, base: 9, spent: 18 },
      recorded: [],
    });
    expect(verdict.dev.cases).toEqual([
      {
        case: DEV[0],
        title: "PLACEHOLDER: Tap the star",
        base: 50,
        head: 100,
        delta: 50,
        trials: 3,
      },
      {
        case: DEV[1],
        title: "PLACEHOLDER: Count the apples",
        base: 50,
        head: 100,
        delta: 50,
        trials: 3,
      },
    ]);
    // Three cases, three trials each, on both sides.
    expect(f.host.authored).toHaveLength(18);
  });

  it("finds head worse when the dev cases or the held-out cases fall", async () => {
    const dev = benchFixture({ passed: (trial) => (trial.side === "head" ? 1 : 3) });
    expect((await dev.bench.compare({ head: dev.head, base: dev.base })).decision).toBe("worse");
    const heldOut = benchFixture({
      passed: (trial) =>
        trial.caseId === HELD_OUT ? (trial.side === "head" ? 0 : 4) : trial.side === "head" ? 4 : 2,
    });
    const verdict = await heldOut.bench.compare({ head: heldOut.head, base: heldOut.base });
    expect(verdict).toMatchObject({ decision: "worse", heldOut: { delta: -100 } });
  });

  it("is inconclusive when the trials disagree more than head rose", async () => {
    // Head wins one trial, loses one and ties one, on every case.
    const f = benchFixture({
      passed: (trial) =>
        [
          [4, 2],
          [2, 4],
          [3, 3],
        ][trial.trial]![trial.side === "head" ? 0 : 1]!,
    });
    const verdict = await f.bench.compare({ head: f.head, base: f.base });
    expect(verdict.decision).toBe("inconclusive");
    expect(verdict.dev.delta).toBe(0);
    expect(verdict.noiseSd).toBeGreaterThan(0);
  });

  it("does not take a rise that came with a wider self-grading gap", async () => {
    // Head passes more hidden checks, but its own tests pass everything.
    const f = benchFixture({
      script: (trial) => ({ ownTests: OWN_TESTS[trial.caseId]! }),
      passed: (trial, own) => (own && trial.side === "head" ? 4 : trial.side === "head" ? 3 : 1),
    });
    const verdict = await f.bench.compare({ head: f.head, base: f.base });
    expect(verdict.dev.delta).toBe(50);
    expect(verdict.guardrails.selfGradingGap).toEqual([0, 0.25]);
    expect(verdict.guardrails.worse).toEqual(["selfGradingGap"]);
    expect(verdict.decision).toBe("inconclusive");
  });

  it("does not take a rise that costs more per trial", async () => {
    const f = benchFixture({
      script: (trial) => ({ costUsd: trial.side === "head" ? 3 : 1 }),
      passed: (trial) => (trial.side === "head" ? 4 : 2),
    });
    const verdict = await f.bench.compare({ head: f.head, base: f.base });
    expect(verdict.guardrails).toMatchObject({ costPerTrial: [1, 3], worse: ["costPerTrial"] });
    expect(verdict.decision).toBe("inconclusive");
    expect(verdict.costUsd).toEqual({ head: 27, base: 9, spent: 36 });
  });

  it("checks Claude Code on the dev cases when its bench login is there", async () => {
    const f = benchFixture({
      claude: true,
      passed: (trial) =>
        trial.runtime === "claude"
          ? trial.side === "head"
            ? 0
            : 4
          : trial.side === "head"
            ? 4
            : 2,
    });
    const verdict = await f.bench.compare({ head: f.head, base: f.base });
    expect(verdict.nonRegression).toEqual({
      runtime: "coding:claude",
      delta: -100,
      ci90: [-100, -100],
    });
    expect(verdict.dev.delta).toBe(50);
    expect(verdict.decision).toBe("worse");
    const claude = f.host.authored.filter((id) => parseTrial(id).runtime === "claude");
    // Dev cases only: two cases, three trials, both sides.
    expect(claude).toHaveLength(12);
    expect(claude.every((id) => DEV.includes(parseTrial(id).caseId))).toBe(true);
  });

  it("interleaves base and head, a trial of every case at a time", async () => {
    const f = benchFixture();
    await f.bench.compare({ head: f.head, base: f.base });
    const order = f.host.authored.map(parseTrial);
    expect(order.slice(0, 6).map((t) => `${t.caseId.slice(0, 8)}/${t.trial}/${t.side}`)).toEqual([
      "CASE-001/0/base",
      "CASE-001/0/head",
      "CASE-002/0/head",
      "CASE-002/0/base",
      "CASE-003/0/base",
      "CASE-003/0/head",
    ]);
    expect(order.map((t) => t.trial)).toEqual([...order.map((t) => t.trial)].sort());
  });

  it("re-runs own tests, scans the block's Traces, and only then unseals its hidden checks", async () => {
    const events: string[] = [];
    const plain = new PlainVault(PLACEHOLDER);
    const vault: CaseVault = {
      sealed: false,
      describe: () => plain.describe(),
      request: (caseId) => plain.request(caseId),
      hidden: (caseId) => {
        events.push(`hidden:${caseId}`);
        return plain.hidden(caseId);
      },
      tripwires: () => plain.tripwires(),
    };
    const f = benchFixture({ vault, script: (trial) => ({ ownTests: OWN_TESTS[trial.caseId]! }) });
    const host = f.host;
    const watched = f.again({
      host: {
        preflight: () => host.preflight(),
        author: async (trial) => {
          events.push(`author:${trial.id}`);
          return host.author(trial);
        },
        traces: async (trial) => {
          events.push(`traces:${trial.id}`);
          return host.traces(trial);
        },
        play: async (trial) => {
          events.push(`play:${trial.id}`);
          return host.play(trial);
        },
        discard: (trial) => host.discard(trial),
      },
    });
    await watched.compare({ head: f.head, base: f.base });
    const firstBlock = events.slice(0, 10).map((event) => event.split(":")[0]);
    expect(firstBlock).toEqual([
      "author",
      "author",
      "traces",
      "traces",
      "play",
      "hidden",
      "play",
      "hidden",
      "author",
      "author",
    ]);
    // Own tests before hidden checks, for every trial.
    for (const id of new Set(f.checks.calls.map((call) => call.slice(call.indexOf(":") + 1)))) {
      expect(f.checks.calls.indexOf(`own:${id}`)).toBeLessThan(
        f.checks.calls.indexOf(`hidden:${id}`),
      );
    }
  });

  it("removes held-out homes once scored, and keeps the dev ones", async () => {
    const f = benchFixture();
    await f.bench.compare({ head: f.head, base: f.base });
    expect(f.host.discarded).toHaveLength(6);
    expect(f.host.discarded.every((id) => parseTrial(id).caseId === HELD_OUT)).toBe(true);
  });

  it("counts trials whose own report says what their re-run tests do not", async () => {
    // Base trials report every check passed; their tests, re-run, pass none. Head reports the truth.
    const f = benchFixture({
      script: (trial) => ({
        ownTests: OWN_TESTS[trial.caseId]!,
        selfReport: OWN_TESTS[trial.caseId]!.criteria.map((criterion) => ({
          criterion,
          status: trial.side === "base" ? "passed" : "failed",
        })),
      }),
      passed: (_trial, own) => (own ? 0 : 2),
    });
    const verdict = await f.bench.compare({ head: f.head, base: f.base });
    expect(verdict.selfReportMismatches).toEqual({ base: 9, head: 0 });
  });

  it("scores a trial that made no module as passing nothing", async () => {
    const f = benchFixture({
      script: (trial) => ({ module: !(trial.side === "head" && trial.caseId === DEV[0]) }),
      passed: () => 4,
    });
    const verdict = await f.bench.compare({ head: f.head, base: f.base });
    expect(verdict.dev.cases[0]).toMatchObject({ base: 100, head: 0 });
    expect(
      f.checks.calls.filter((call) => call.includes(`${DEV[0]}/`) && call.endsWith("/head")),
    ).toEqual([]);
  });
});
