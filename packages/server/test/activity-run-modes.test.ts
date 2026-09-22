import { describe, expect, it } from "vitest";
import {
  assistBlocks,
  invalidatedBy,
  nextStage,
  pipelinePlan,
  stageReadiness,
  type PipelineSituation,
} from "../src/activities/run-modes.js";
import { stageStatuses, type ActivityStage } from "../src/activities/stages.js";
import {
  ASSESSMENT_STAGE,
  BEHAVIOR_STAGE,
  PIPELINE_STAGES,
  SCAFFOLD_STAGE,
  SPEC_STAGE,
} from "../src/activities/pipeline.js";

const graph: ActivityStage[] = [
  { id: "one", order: 10, execution: "agent", dependsOn: [] },
  { id: "two", order: 20, execution: "deterministic", dependsOn: ["one"] },
  { id: "shared", order: 30, execution: "deterministic", dependsOn: ["one"], sharedModule: true },
];

function situation(
  completions: { stageId: string; finishedAt: string; inputRevision?: string }[],
  overrides: Partial<PipelineSituation> = {},
): PipelineSituation {
  return {
    statuses: stageStatuses(
      graph,
      completions.map((entry) => ({ ...entry, inputRevision: entry.inputRevision ?? "r1" })),
      "r1",
    ),
    canonicalRef: true,
    canonicalRefNum: 1,
    inFlight: false,
    ...overrides,
  };
}

describe("one stage at a time", () => {
  it("lets the first stage start on a fresh activity", () => {
    expect(stageReadiness(graph, situation([]), "one")?.blocks).toEqual([]);
  });

  it("blocks a stage whose upstream has never run, naming it", () => {
    expect(stageReadiness(graph, situation([]), "two")?.blocks).toEqual([
      { kind: "upstream_missing", stageIds: ["one"] },
    ]);
  });

  it("lets a stage start once its upstream has run, even while stale", () => {
    // Stale is not blocked: re-running a stage against a changed draft is the point.
    const ran = [{ stageId: "one", finishedAt: "2026-01-01T00:00:00Z", inputRevision: "old" }];
    expect(stageReadiness(graph, situation(ran), "two")?.blocks).toEqual([]);
  });

  it("refuses a shared-module stage on a ref that does not own the module", () => {
    const ran = [{ stageId: "one", finishedAt: "2026-01-01T00:00:00Z" }];
    const blocks = stageReadiness(
      graph,
      situation(ran, { canonicalRef: false, canonicalRefNum: 3 }),
      "shared",
    )?.blocks;
    expect(blocks).toEqual([{ kind: "not_canonical_ref", canonicalRefNum: 3 }]);
  });

  it("allows a shared-module stage on the canonical ref", () => {
    const ran = [{ stageId: "one", finishedAt: "2026-01-01T00:00:00Z" }];
    expect(stageReadiness(graph, situation(ran), "shared")?.blocks).toEqual([]);
  });

  it("gives every reason at once rather than one per round trip", () => {
    const blocks = stageReadiness(
      graph,
      situation([], { canonicalRef: false, canonicalRefNum: 3, inFlight: true }),
      "shared",
    )?.blocks;
    expect(blocks?.map((block) => block.kind)).toEqual([
      "upstream_missing",
      "not_canonical_ref",
      "run_in_flight",
    ]);
  });

  it("reports nothing for a stage the registry does not have", () => {
    expect(stageReadiness(graph, situation([]), "ghost")).toBeNull();
  });
});

describe("the whole pipeline", () => {
  it("plans every stage on a fresh activity, in order", () => {
    expect(pipelinePlan(graph, situation([])).map((stage) => stage.id)).toEqual([
      "one",
      "two",
      "shared",
    ]);
  });

  it("drops what is already current", () => {
    const ran = [
      { stageId: "one", finishedAt: "2026-01-01T00:00:00Z" },
      { stageId: "two", finishedAt: "2026-01-02T00:00:00Z" },
      { stageId: "shared", finishedAt: "2026-01-03T00:00:00Z" },
    ];
    expect(pipelinePlan(graph, situation(ran))).toEqual([]);
  });

  it("includes a stale stage again", () => {
    const ran = [
      { stageId: "one", finishedAt: "2026-01-03T00:00:00Z" },
      { stageId: "two", finishedAt: "2026-01-01T00:00:00Z" },
      { stageId: "shared", finishedAt: "2026-01-02T00:00:00Z" },
    ];
    expect(pipelinePlan(graph, situation(ran)).map((stage) => stage.id)).toEqual(["two", "shared"]);
  });

  it("leaves out a shared-module stage this ref may never run", () => {
    expect(
      pipelinePlan(graph, situation([], { canonicalRef: false, canonicalRefNum: 3 })).map(
        (stage) => stage.id,
      ),
    ).toEqual(["one", "two"]);
  });

  it("still plans while a run is in flight, because a plan is not an instruction", () => {
    expect(pipelinePlan(graph, situation([], { inFlight: true })).map((s) => s.id)).toEqual([
      "one",
      "two",
      "shared",
    ]);
  });

  it("starts nothing while a run is in flight", () => {
    expect(nextStage(graph, situation([], { inFlight: true }))).toBeNull();
  });

  it("starts the earliest stage that can go", () => {
    expect(nextStage(graph, situation([]))?.id).toBe("one");
    const ran = [{ stageId: "one", finishedAt: "2026-01-01T00:00:00Z" }];
    expect(nextStage(graph, situation(ran))?.id).toBe("two");
  });

  it("stops when there is nothing left", () => {
    const ran = [
      { stageId: "one", finishedAt: "2026-01-01T00:00:00Z" },
      { stageId: "two", finishedAt: "2026-01-02T00:00:00Z" },
      { stageId: "shared", finishedAt: "2026-01-03T00:00:00Z" },
    ];
    expect(nextStage(graph, situation(ran))).toBeNull();
  });
});

describe("an assist session", () => {
  it("opens without any stage rules, because it claims no stage's output", () => {
    expect(assistBlocks(situation([], { canonicalRef: false }))).toEqual([]);
  });

  it("waits for a run already in flight, the one limit the server imposes", () => {
    expect(assistBlocks(situation([], { inFlight: true, inFlightStageId: "one" }))).toEqual([
      { kind: "run_in_flight", stageId: "one" },
    ]);
  });
});

describe("against the ported pipeline", () => {
  it("names what regenerating the specification invalidates", () => {
    expect(invalidatedBy(PIPELINE_STAGES, SPEC_STAGE)).toHaveLength(8);
  });

  it("refuses all three shared-module stages on a non-canonical ref", () => {
    const statuses = stageStatuses(
      PIPELINE_STAGES,
      PIPELINE_STAGES.map((stage) => ({
        stageId: stage.id,
        finishedAt: "2026-01-01T00:00:00Z",
        inputRevision: "r1",
      })),
      "r1",
    );
    const state: PipelineSituation = {
      statuses,
      canonicalRef: false,
      canonicalRefNum: 2,
      inFlight: false,
    };
    for (const stageId of [SCAFFOLD_STAGE, ASSESSMENT_STAGE, BEHAVIOR_STAGE])
      expect(stageReadiness(PIPELINE_STAGES, state, stageId)?.blocks).toEqual([
        { kind: "not_canonical_ref", canonicalRefNum: 2 },
      ]);
  });
});
