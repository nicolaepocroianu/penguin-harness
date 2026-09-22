/**
 * `prepare_media_assets` — the pipeline's first deterministic stage, and the first real
 * contributor to the stage slot.
 *
 * Loom's version reads the media-enriched specification and normalises it into asset
 * records. Penguin already does that work in `planMedia`, which walks the specification's
 * scenes and produces one manifest entry per declared image, video, animation and audio
 * track, with the scene usages that reference it. So this stage is not new code: it is the
 * existing planning step, given a name, a place in the graph, and a record of having run.
 *
 * Deterministic on purpose. No agent, no workspace to write into, no approvals — which
 * matters, because most of the people driving this pipeline are not engineers and should
 * not be approving tool calls to get a manifest.
 */
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { ActivityAuthoring } from "../mechanisms/activities.js";
import { PREPARE_MEDIA_STAGE } from "./pipeline.js";
import type { StageContext, StageOutcome, StageRunner } from "./stage-registry.js";

/** How many unbound assets to name before the message stops being readable. */
const NAMED_UNBOUND = 5;

/**
 * What this stage produced, as a sentence and a list of gaps.
 *
 * Pure, so the wording is testable without a database: the stage is a thin wrapper that
 * plans the media and then describes what it planned.
 */
export function describePreparedMedia(assets: { key: string; path?: string }[]): StageOutcome {
  const unbound = assets.filter((asset) => !asset.path).map((asset) => asset.key);
  const summary =
    assets.length === 0
      ? "The specification declares no media."
      : `Prepared ${assets.length} media ${assets.length === 1 ? "asset" : "assets"}, ${assets.length - unbound.length} already bound to a file.`;
  if (!unbound.length) return { summary };
  // Named, not counted: an author fixing these needs to know which. Beyond a handful the
  // list stops helping, so the rest are counted instead.
  const named = unbound.slice(0, NAMED_UNBOUND).join(", ");
  const rest = unbound.length - Math.min(unbound.length, NAMED_UNBOUND);
  return {
    summary,
    problems: [
      `${unbound.length} ${unbound.length === 1 ? "asset has" : "assets have"} no file yet: ${named}${rest ? ` and ${rest} more` : ""}.`,
    ],
  };
}

@Component({
  contributes: {
    "ActivityStageModule.stages": [
      {
        id: PREPARE_MEDIA_STAGE,
        order: 30,
        execution: "deterministic",
        dependsOn: ["generate_media_spec"],
      },
    ],
  },
})
export class PrepareMediaStage implements StageRunner {
  @Use() private readonly activities!: ActivityAuthoring;

  async run(context: StageContext): Promise<StageOutcome> {
    // The plan is derived from the specification every time rather than read back, so a
    // stage that runs twice on the same specification produces the same manifest. The
    // revision is passed through: a draft that moved since this run started is a conflict,
    // not something to plan against.
    const draft = await this.activities.planMedia(
      context.projectId,
      context.activityId,
      context.inputRevision,
    );
    return describePreparedMedia(draft.mediaPlan?.manifest.assets["en-US"] ?? []);
  }
}
