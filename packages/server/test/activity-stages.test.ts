import { describe, expect, it } from "vitest";
import {
  dependentsOf,
  downstreamOf,
  misorderedStages,
  orderedStages,
  registryProblems,
  pendingStages,
  stageStatuses,
  upstreamOf,
  type ActivityStage,
} from "../src/activities/stages.js";
import {
  ASSESSMENT_STAGE,
  ASSETS_CONFIG_STAGE,
  AUDIO_STAGE,
  BEHAVIOR_STAGE,
  IMAGES_STAGE,
  MEDIA_SPEC_STAGE,
  PIPELINE_STAGES,
  PREPARE_MEDIA_STAGE,
  SCAFFOLD_STAGE,
  SPEC_STAGE,
} from "../src/activities/pipeline.js";

const ids = (stages: readonly ActivityStage[]) => stages.map((stage) => stage.id);

function stage(id: string, order: number, dependsOn: string[] = []): ActivityStage {
  return { id, order, execution: "deterministic", dependsOn };
}

describe("ordering", () => {
  it("sorts by order and breaks ties by id, so load order never decides", () => {
    const shuffled = [stage("c", 20), stage("b", 10), stage("a", 10)];
    expect(ids(orderedStages(shuffled))).toEqual(["a", "b", "c"]);
    // Sorting must not mutate the caller's array.
    expect(ids(shuffled)).toEqual(["c", "b", "a"]);
  });
});

describe("dependency closure", () => {
  const chain = [
    stage("one", 10),
    stage("two", 20, ["one"]),
    stage("three", 30, ["two"]),
    stage("aside", 40, ["one"]),
  ];

  it("names the stages that consume a stage directly", () => {
    expect(ids(dependentsOf(chain, "one"))).toEqual(["two", "aside"]);
    expect(ids(dependentsOf(chain, "three"))).toEqual([]);
  });

  it("follows the whole chain, because a stage two steps away is just as wrong", () => {
    expect(ids(downstreamOf(chain, "one"))).toEqual(["two", "three", "aside"]);
    expect(ids(downstreamOf(chain, "two"))).toEqual(["three"]);
    expect(ids(downstreamOf(chain, "three"))).toEqual([]);
  });

  it("does not put a stage in its own closure", () => {
    expect(ids(downstreamOf(chain, "one"))).not.toContain("one");
  });

  it("returns nothing for a stage that is not in the registry", () => {
    expect(downstreamOf(chain, "absent")).toEqual([]);
  });

  it("reads the chain backwards for what must already have run", () => {
    expect(ids(upstreamOf(chain, "three"))).toEqual(["one", "two"]);
    expect(ids(upstreamOf(chain, "one"))).toEqual([]);
  });

  it("terminates on a cycle rather than walking it forever", () => {
    const cyclic = [stage("a", 10, ["b"]), stage("b", 20, ["a"])];
    expect(ids(downstreamOf(cyclic, "a"))).toEqual(["b"]);
    expect(ids(upstreamOf(cyclic, "a"))).toEqual(["b"]);
  });
});

describe("registry problems", () => {
  it("passes a sound registry", () => {
    expect(registryProblems([stage("a", 10), stage("b", 20, ["a"])])).toEqual([]);
  });

  it("names a dependency nobody provides", () => {
    expect(registryProblems([stage("b", 20, ["ghost"])])).toEqual([
      'Stage "b" depends on "ghost", which no stage provides.',
    ]);
  });

  it("names a duplicate id", () => {
    expect(registryProblems([stage("a", 10), stage("a", 20)])).toContain(
      'Two stages share the id "a".',
    );
  });

  it("names the cycle rather than just asserting there is one", () => {
    const problems = registryProblems([
      stage("a", 10, ["c"]),
      stage("b", 20, ["a"]),
      stage("c", 30, ["b"]),
    ]);
    expect(problems.some((problem) => problem.startsWith("Stages form a cycle:"))).toBe(true);
  });
});

describe("order against dependencies", () => {
  it("reports a stage that depends on one running no earlier", () => {
    expect(misorderedStages([stage("a", 30), stage("b", 20, ["a"])])).toEqual([
      'Stage "b" (order 20) depends on "a" (order 30), which does not run earlier.',
    ]);
  });

  it("says nothing when the two statements agree", () => {
    expect(misorderedStages([stage("a", 10), stage("b", 20, ["a"])])).toEqual([]);
  });
});

describe("the ported pipeline", () => {
  it("is sound and consistently ordered", () => {
    expect(registryProblems(PIPELINE_STAGES)).toEqual([]);
    expect(misorderedStages(PIPELINE_STAGES)).toEqual([]);
  });

  it("runs in Loom's order", () => {
    expect(ids(orderedStages(PIPELINE_STAGES))).toEqual([
      SPEC_STAGE,
      MEDIA_SPEC_STAGE,
      PREPARE_MEDIA_STAGE,
      SCAFFOLD_STAGE,
      ASSETS_CONFIG_STAGE,
      ASSESSMENT_STAGE,
      AUDIO_STAGE,
      BEHAVIOR_STAGE,
      IMAGES_STAGE,
    ]);
  });

  it("splits agent work from deterministic work as agreed", () => {
    const byExecution = Object.fromEntries(
      PIPELINE_STAGES.map((entry) => [entry.id, entry.execution]),
    );
    expect(byExecution).toEqual({
      [SPEC_STAGE]: "agent",
      [MEDIA_SPEC_STAGE]: "agent",
      [PREPARE_MEDIA_STAGE]: "deterministic",
      [SCAFFOLD_STAGE]: "deterministic",
      [ASSETS_CONFIG_STAGE]: "deterministic",
      [ASSESSMENT_STAGE]: "agent",
      [AUDIO_STAGE]: "deterministic",
      [BEHAVIOR_STAGE]: "agent",
      [IMAGES_STAGE]: "agent",
    });
  });

  it("marks exactly the three stages that write the shared module", () => {
    expect(
      orderedStages(PIPELINE_STAGES.filter((entry) => entry.sharedModule)).map((e) => e.id),
    ).toEqual([SCAFFOLD_STAGE, ASSESSMENT_STAGE, BEHAVIOR_STAGE]);
  });

  it("makes regenerating the specification invalidate everything after it", () => {
    expect(ids(downstreamOf(PIPELINE_STAGES, SPEC_STAGE))).toEqual([
      MEDIA_SPEC_STAGE,
      PREPARE_MEDIA_STAGE,
      SCAFFOLD_STAGE,
      ASSETS_CONFIG_STAGE,
      ASSESSMENT_STAGE,
      AUDIO_STAGE,
      BEHAVIOR_STAGE,
      IMAGES_STAGE,
    ]);
  });

  it("keeps narration and artwork out of each other's way", () => {
    // Regenerating audio must not mark the images stale, and the reverse.
    expect(ids(downstreamOf(PIPELINE_STAGES, AUDIO_STAGE))).toEqual([]);
    expect(ids(downstreamOf(PIPELINE_STAGES, IMAGES_STAGE))).toEqual([]);
  });

  it("knows what behaviour implementation waits for", () => {
    expect(ids(upstreamOf(PIPELINE_STAGES, BEHAVIOR_STAGE))).toEqual([
      SPEC_STAGE,
      SCAFFOLD_STAGE,
      ASSESSMENT_STAGE,
    ]);
  });
});

describe("staleness", () => {
  const graph = [stage("one", 10), stage("two", 20, ["one"]), stage("three", 30, ["two"])];
  const ran = (stageId: string, finishedAt: string, inputRevision = "r1") => ({
    stageId,
    finishedAt,
    inputRevision,
  });

  it("calls a stage that never ran missing rather than stale", () => {
    const [first] = stageStatuses(graph, [], "r1");
    expect(first).toMatchObject({ missing: true, stale: false, reasons: [] });
  });

  it("marks a stage stale when the draft moved under it", () => {
    const statuses = stageStatuses(graph, [ran("one", "2026-01-01T00:00:00Z", "old")], "r1");
    expect(statuses[0]).toMatchObject({ missing: false, stale: true });
    expect(statuses[0]!.reasons).toEqual(["the draft changed since"]);
  });

  it("marks a stage stale when something it depends on ran again afterwards", () => {
    const statuses = stageStatuses(
      graph,
      [ran("one", "2026-01-02T00:00:00Z"), ran("two", "2026-01-01T00:00:00Z")],
      "r1",
    );
    expect(statuses[0]).toMatchObject({ stale: false });
    expect(statuses[1]).toMatchObject({ stale: true, reasons: ["one ran again"] });
  });

  it("follows the chain, so a re-run two steps up still shows", () => {
    const statuses = stageStatuses(
      graph,
      [
        ran("one", "2026-01-03T00:00:00Z"),
        ran("two", "2026-01-01T00:00:00Z"),
        ran("three", "2026-01-02T00:00:00Z"),
      ],
      "r1",
    );
    expect(statuses[2]).toMatchObject({ stale: true, reasons: ["one ran again"] });
  });

  it("leaves a stage alone when its upstream ran before it", () => {
    const statuses = stageStatuses(
      graph,
      [ran("one", "2026-01-01T00:00:00Z"), ran("two", "2026-01-02T00:00:00Z")],
      "r1",
    );
    expect(statuses[1]).toMatchObject({ stale: false, reasons: [] });
  });

  it("collects every reason rather than stopping at the first", () => {
    const statuses = stageStatuses(
      graph,
      [ran("one", "2026-01-03T00:00:00Z"), ran("two", "2026-01-01T00:00:00Z", "old")],
      "r1",
    );
    expect(statuses[1]!.reasons).toEqual(["the draft changed since", "one ran again"]);
  });

  it("offers a whole-pipeline run the missing and the stale, in order", () => {
    const statuses = stageStatuses(graph, [ran("one", "2026-01-01T00:00:00Z")], "r1");
    expect(ids(pendingStages(statuses))).toEqual(["two", "three"]);
  });

  it("offers nothing when everything is current", () => {
    const statuses = stageStatuses(
      graph,
      [
        ran("one", "2026-01-01T00:00:00Z"),
        ran("two", "2026-01-02T00:00:00Z"),
        ran("three", "2026-01-03T00:00:00Z"),
      ],
      "r1",
    );
    expect(pendingStages(statuses)).toEqual([]);
  });
});
