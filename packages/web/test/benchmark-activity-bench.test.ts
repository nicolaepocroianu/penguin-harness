/**
 * The Evaluation Center's activity bench section: what a folder pick asks the server for, the
 * order a board's evaluations are read in, and that the section only reads (its one write is the
 * admin's choice of bench home) through the typed client. Its flow is covered by the activities
 * e2e.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BenchmarkEvaluation } from "@waterford/waf-harness-server/api";
import { benchHomeChoice, newestFirst } from "../src/features/benchmark/activity-bench-model";

const evaluation = (version: number): BenchmarkEvaluation => ({
  time: `2026-10-1${version}T10:00:00.000Z`,
  agentId: "activity_agent",
  modelId: "m",
  provider: "custom",
  thinkingLevel: "medium",
  score: 60 + version,
  version,
  cost: null,
  durationMs: 1000,
  cases: [],
});

describe("the bench home a pick asks for", () => {
  it("asks for the folder picked, and forgets it on an empty pick", () => {
    expect(benchHomeChoice("/srv/bench")).toBe("/srv/bench");
    expect(benchHomeChoice("  C:\\bench  ")).toBe("C:\\bench");
    expect(benchHomeChoice("")).toBeNull();
    expect(benchHomeChoice("   ")).toBeNull();
  });
});

describe("a board's evaluations", () => {
  it("reads newest first, leaving the scoreboard's own order alone", () => {
    const recorded = [evaluation(1), evaluation(2), evaluation(3)];
    expect(newestFirst(recorded).map((item) => item.version)).toEqual([3, 2, 1]);
    expect(recorded.map((item) => item.version)).toEqual([1, 2, 3]);
  });
});

describe("the section reads through the typed client", () => {
  it("reads the bench and chooses its home by their endpoints, and nothing else", () => {
    const source = readFileSync(
      new URL("../src/features/benchmark/activity-bench-section.tsx", import.meta.url),
      "utf8",
    );
    const calls = [...source.matchAll(/api\.([A-Za-z]+)\(/g)].map((match) => match[1]);
    expect(new Set(calls)).toEqual(new Set(["adminActivityBench", "adminSetActivityBenchHome"]));
    expect(source).not.toMatch(/apiFetch|fetch\(/);
  });
});
