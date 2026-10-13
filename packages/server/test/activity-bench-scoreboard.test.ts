/**
 * The activity bench's records, read back the way the Evaluation Center reads any Benchmark
 * (BenchmarkService, over its route): agent-tuning's format unchanged, the dev cases' public
 * parts only, base recorded once per recipe — the first as the Formal Baseline — and head only
 * when it is better.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  BenchmarkCasesResponse,
  BenchmarksResponse,
  ProjectCreateResponse,
} from "../src/api/types.js";
import { benchFixture, removeTemps } from "./activity-bench-fixtures.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";

afterEach(removeTemps);

describe("the activity bench's scoreboard", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("records the Formal Baseline, then each better head, readable as a Benchmark", async () => {
    const t = await createTestApp();
    cleanups.push(() => t.cleanup());
    const owner = apiClient(t.app, (await provisionUser(t.app, "bench_owner")).cookie);
    const { project } = (await (
      await owner.post("/api/projects", { projectId: "bench_owner-scores", name: "Scores" })
    ).json()) as ProjectCreateResponse;
    // Each side's dev score, by commit; held-out scores do not move.
    const scores = new Map<string, number>();
    const f = benchFixture({
      home: t.root,
      project: project.projectId,
      record: true,
      passed: (trial) => {
        if (trial.caseId.startsWith("CASE-003")) return 3;
        return trial.side === "head" ? (scores.get("head") ?? 2) : (scores.get("base") ?? 2);
      },
    });

    scores.set("base", 2).set("head", 4);
    const first = await f.bench.compare({ head: f.head, base: f.base });
    expect(first).toMatchObject({ decision: "better", recorded: [1, 2] });

    // A later head over the one just recorded: only the new head is written.
    const second = f.repo.commit(
      { "plugins/waf-authoring/skills/authoring/SKILL.md": "second\n" },
      "second",
    );
    scores.set("base", 3).set("head", 4);
    expect(await f.bench.compare({ head: second, base: f.head })).toMatchObject({
      decision: "better",
      recorded: [3],
    });

    // A head that is worse is not written, and its base is already there.
    const third = f.repo.commit(
      { "plugins/waf-authoring/skills/authoring/SKILL.md": "third\n" },
      "third",
    );
    scores.set("base", 4).set("head", 1);
    expect(await f.bench.compare({ head: third, base: second })).toMatchObject({
      decision: "worse",
      recorded: [],
    });

    const { benchmarks } = (await (
      await owner.get(`/api/projects/${project.projectId}/benchmarks`)
    ).json()) as BenchmarksResponse;
    const bench = benchmarks.find((item) => item.id === "activity-bench-r1");
    expect(bench).toMatchObject({
      title: "Activity bench r1",
      runs: 3,
      status: "published",
      caseCount: 2,
    });
    expect(bench!.description).toContain("held-out cases (1) are reported only in each comparison");
    expect(bench!.evaluations.map((e) => [e.version, e.summaryTitle, e.score])).toEqual([
      [1, `Formal baseline at ${f.base.slice(0, 12)}`, 50],
      [2, `Better: ${f.head.slice(0, 12)} over ${f.base.slice(0, 12)}`, 100],
      [3, `Better: ${second.slice(0, 12)} over ${f.head.slice(0, 12)}`, 100],
    ]);
    const formal = bench!.evaluations[0]!;
    expect(formal).toMatchObject({
      agentId: "activity_agent",
      provider: "scripted",
      modelId: "model",
      thinkingLevel: "medium",
      cost: 1,
      durationMs: 60_000,
    });
    expect(formal.summary).toContain(`Commit ${f.base}`);
    expect(formal.cases.map((item) => [item.case, item.score, item.runs.length])).toEqual([
      ["CASE-001-placeholder-tap-the-star", 50, 3],
      ["CASE-002-placeholder-count-the-apples", 50, 3],
    ]);
    expect(formal.cases[0]!.runs[0]).toMatchObject({ score: 50, cost: 1, durationMs: 60_000 });
    expect(formal.cases[0]!.runs[0]!.sessionId).toMatch(/^ses_/);

    const { cases } = (await (
      await owner.get(`/api/projects/${project.projectId}/benchmarks/activity-bench-r1/cases`)
    ).json()) as BenchmarkCasesResponse;
    expect(cases).toEqual([
      { id: "CASE-001-placeholder-tap-the-star", title: "PLACEHOLDER: Tap the star" },
      { id: "CASE-002-placeholder-count-the-apples", title: "PLACEHOLDER: Count the apples" },
    ]);
  });

  it("writes nothing for a vault that is not fit to score, or a comparison that is invalid", async () => {
    const t = await createTestApp();
    cleanups.push(() => t.cleanup());
    const f = benchFixture({ home: t.root, project: "nowhere", record: false });
    expect((await f.bench.compare({ head: f.head, base: f.base })).recorded).toEqual([]);
    const refused = benchFixture({
      home: t.root,
      project: "nowhere",
      record: true,
      refused: "Not ready.",
    });
    expect(
      (await refused.bench.compare({ head: refused.head, base: refused.base })).recorded,
    ).toEqual([]);
    expect(fs.existsSync(path.join(t.root, "nowhere", "benchmarks"))).toBe(false);
  });
});
