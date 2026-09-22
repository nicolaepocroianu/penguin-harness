import { describe, expect, it } from "vitest";
import {
  ActivityStagesModule,
  type StageContext,
  type StageOutcome,
  type StageRunner,
} from "../src/activities/stage-registry.js";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import { describePreparedMedia } from "../src/activities/prepare-media-stage.js";
import {
  describeAssetsConfiguration,
  describeScaffold,
} from "../src/activities/scaffold-stages.js";

/** A runner that records it was called, since the registry only has to hand it back. */
function runner(summary: string): StageRunner & { calls: StageContext[] } {
  const calls: StageContext[] = [];
  return {
    calls,
    async run(context: StageContext): Promise<StageOutcome> {
      calls.push(context);
      return { summary };
    },
  };
}

interface Contribution {
  id: string;
  data: Record<string, unknown>;
  code: StageRunner;
}

/** Assembles the module the way the kernel does, with the contributions given. */
function assemble(stages: Contribution[]) {
  const module = new ActivityStagesModule();
  module.setup({ contributions: { stages } } as unknown as ClassCtx);
  return module.stages;
}

/** The interface hands back an opaque handle; a caller casts it to run the stage. */
const asRunner = (handle: unknown): StageRunner => handle as StageRunner;

const one = { id: "one", data: { order: 10, execution: "agent", dependsOn: [] } };
const two = { id: "two", data: { order: 20, execution: "deterministic", dependsOn: ["one"] } };

describe("assembling the registry", () => {
  it("hands back the pipeline in order, whatever order it was contributed in", () => {
    const stages = assemble([
      { ...two, code: runner("two") },
      { ...one, code: runner("one") },
    ]);
    expect(stages.all().map((stage) => stage.id)).toEqual(["one", "two"]);
  });

  it("keeps each stage's declaration", () => {
    const stages = assemble([
      { ...one, code: runner("one") },
      { ...two, code: runner("two") },
    ]);
    expect(stages.get("two")).toEqual({
      id: "two",
      order: 20,
      execution: "deterministic",
      dependsOn: ["one"],
    });
    expect(stages.get("absent")).toBeUndefined();
  });

  it("carries sharedModule only when it was declared", () => {
    const stages = assemble([
      { id: "plain", data: { order: 10, execution: "agent", dependsOn: [] }, code: runner("p") },
      {
        id: "shared",
        data: { order: 20, execution: "agent", dependsOn: [], sharedModule: true },
        code: runner("s"),
      },
    ]);
    expect(stages.get("plain")).not.toHaveProperty("sharedModule");
    expect(stages.get("shared")!.sharedModule).toBe(true);
  });

  it("treats an absent dependsOn as no dependencies rather than undefined", () => {
    const stages = assemble([
      { id: "bare", data: { order: 10, execution: "agent" }, code: runner("b") },
    ]);
    expect(stages.get("bare")!.dependsOn).toEqual([]);
  });

  it("binds each stage's runner by id", async () => {
    const first = runner("did one");
    const stages = assemble([
      { ...one, code: first },
      { ...two, code: runner("did two") },
    ]);
    const context: StageContext = {
      projectId: "p",
      activityId: "a",
      inputRevision: "r1",
      workspace: "/tmp/run",
    };
    await expect(asRunner(stages.runner("one")).run(context)).resolves.toEqual({
      summary: "did one",
    });
    expect(first.calls).toEqual([context]);
    expect(stages.runner("absent")).toBeUndefined();
  });
});

describe("checking itself at assembly", () => {
  it("refuses a dependency nobody provides, rather than failing at generation time", () => {
    expect(() =>
      assemble([
        {
          id: "b",
          data: { order: 20, execution: "agent", dependsOn: ["ghost"] },
          code: runner("b"),
        },
      ]),
    ).toThrow(/depends on "ghost", which no stage provides/);
  });

  it("refuses a cycle, and names it", () => {
    expect(() =>
      assemble([
        { id: "a", data: { order: 10, execution: "agent", dependsOn: ["b"] }, code: runner("a") },
        { id: "b", data: { order: 20, execution: "agent", dependsOn: ["a"] }, code: runner("b") },
      ]),
    ).toThrow(/cycle/);
  });

  it("refuses an order that disagrees with its dependencies", () => {
    expect(() =>
      assemble([
        { id: "a", data: { order: 30, execution: "agent", dependsOn: [] }, code: runner("a") },
        { id: "b", data: { order: 20, execution: "agent", dependsOn: ["a"] }, code: runner("b") },
      ]),
    ).toThrow(/does not run earlier/);
  });

  it("reports every problem at once, not the first", () => {
    let message = "";
    try {
      assemble([
        {
          id: "a",
          data: { order: 30, execution: "agent", dependsOn: ["ghost"] },
          code: runner("a"),
        },
        { id: "b", data: { order: 20, execution: "agent", dependsOn: ["a"] }, code: runner("b") },
      ]);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("no stage provides");
    expect(message).toContain("does not run earlier");
  });

  it("assembles an empty registry rather than complaining about it", () => {
    expect(assemble([]).all()).toEqual([]);
  });
});

describe("what prepare_media_assets reports", () => {
  it("says so when the specification declares no media at all", () => {
    expect(describePreparedMedia([])).toEqual({
      summary: "The specification declares no media.",
    });
  });

  it("counts what it prepared and how much is already bound", () => {
    expect(
      describePreparedMedia([
        { key: "a", path: "media/images/a.png" },
        { key: "b", path: "media/images/b.png" },
      ]),
    ).toEqual({ summary: "Prepared 2 media assets, 2 already bound to a file." });
  });

  it("uses the singular for one asset", () => {
    expect(describePreparedMedia([{ key: "a", path: "media/images/a.png" }]).summary).toBe(
      "Prepared 1 media asset, 1 already bound to a file.",
    );
  });

  it("names the assets with no file, because an author needs to know which", () => {
    const outcome = describePreparedMedia([
      { key: "bound", path: "media/images/a.png" },
      { key: "loose-one" },
      { key: "loose-two" },
    ]);
    expect(outcome.summary).toBe("Prepared 3 media assets, 1 already bound to a file.");
    expect(outcome.problems).toEqual(["2 assets have no file yet: loose-one, loose-two."]);
  });

  it("stops naming past a handful and counts the rest", () => {
    const outcome = describePreparedMedia(
      Array.from({ length: 8 }, (_, index) => ({ key: `k${index}` })),
    );
    expect(outcome.problems).toEqual(["8 assets have no file yet: k0, k1, k2, k3, k4 and 3 more."]);
  });

  it("reports an unbound asset rather than calling the manifest complete", () => {
    // The rule this stage inherits: a missing file is named, never passed off as success.
    expect(describePreparedMedia([{ key: "only" }]).problems).toHaveLength(1);
  });
});

describe("what scaffold_module reports", () => {
  it("names the file count and the module kind", () => {
    expect(describeScaffold(14, undefined).summary).toBe("Wrote 14 module files.");
    expect(describeScaffold(1, undefined).summary).toBe("Wrote 1 module file.");
    expect(describeScaffold(9, "readAlong").summary).toBe("Wrote 9 readAlong book module files.");
  });

  it("treats an empty scaffold as a problem, not a quiet success", () => {
    const outcome = describeScaffold(0, undefined);
    expect(outcome.summary).toBe("Wrote no module files.");
    expect(outcome.problems).toEqual([
      "The scaffold produced nothing, so there is no module to implement.",
    ]);
  });
});

describe("what assets_configuration reports", () => {
  const manifest = (assets: Record<string, { key: string; type: "image"; path?: string }[]>) =>
    ({ productCode: "code", refNum: 1, assets }) as never;

  it("counts bound assets across the languages it configured", () => {
    const outcome = describeAssetsConfiguration(
      manifest({
        "en-US": [{ key: "a", type: "image", path: "media/images/a.png" }],
        "es-MX": [{ key: "a", type: "image", path: "media/images/a-es.png" }],
      }),
    );
    expect(outcome).toEqual({ summary: "Configured 2 bound assets across 2 languages." });
  });

  it("uses the singular for one of each", () => {
    expect(
      describeAssetsConfiguration(
        manifest({ "en-US": [{ key: "a", type: "image", path: "media/images/a.png" }] }),
      ).summary,
    ).toBe("Configured 1 bound asset across 1 language.");
  });

  it("names a language with nothing bound, because silence does not fail", () => {
    const outcome = describeAssetsConfiguration(
      manifest({
        "en-US": [{ key: "a", type: "image", path: "media/images/a.png" }],
        "ro-RO": [{ key: "a", type: "image" }],
      }),
    );
    expect(outcome.problems).toEqual([
      "Language with nothing bound: ro-RO. An unbound language plays silence rather than failing.",
    ]);
  });

  it("treats a manifest with no languages as a problem", () => {
    expect(describeAssetsConfiguration(manifest({})).problems).toEqual([
      "The manifest holds no languages, so there is nothing to configure.",
    ]);
  });
});
