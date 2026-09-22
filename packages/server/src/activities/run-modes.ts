/**
 * The three ways to drive the pipeline, over one registry.
 *
 * Loom can only run stages as a batch: a list of stage names goes in, they execute in
 * order, and that is the whole vocabulary. Penguin's reason for existing here is the other
 * two — re-running a single stage, and opening an agent session and prompting it directly.
 *
 * All three answer the same question: which stages may start right now. Keeping that
 * answer in one pure place means the whole-pipeline button and a single re-run cannot
 * disagree about whether a stage is allowed to run.
 */
import {
  downstreamOf,
  orderedStages,
  pendingStages,
  upstreamOf,
  type ActivityStage,
  type StageStatus,
} from "./stages.js";

export type RunMode =
  /** Start every stage that is missing or stale, in order. */
  | "pipeline"
  /** Start exactly one stage, whatever its neighbours look like. */
  | "stage"
  /** An agent session in the activity's context, with no stage semantics. */
  | "assist";

/** Why a stage cannot start. Each is something an author can act on. */
export type StageBlock =
  /** Something it reads has never run. */
  | { kind: "upstream_missing"; stageIds: string[] }
  /** It writes the module every ref of the product shares, and this is not that ref. */
  | { kind: "not_canonical_ref"; canonicalRefNum: number | null }
  /** A run is already going for this activity; the server allows one at a time. */
  | { kind: "run_in_flight"; stageId: string | null };

export interface StageReadiness {
  stage: ActivityStage;
  /** Empty when it may start. */
  blocks: StageBlock[];
}

export interface PipelineSituation {
  statuses: readonly StageStatus[];
  /** Whether this activity's ref owns the module its product shares. */
  canonicalRef: boolean;
  canonicalRefNum: number | null;
  /** The stage a run already in flight is doing, or null for an older kind of run. */
  inFlightStageId?: string | null;
  /** Whether any run is in flight at all. */
  inFlight: boolean;
}

/**
 * Whether one stage may start, and if not, every reason at once.
 *
 * Every reason rather than the first: an author told only "not the canonical ref" will fix
 * that, press the button again, and be told the upstream is missing. Two round trips to
 * learn what one message could have said.
 */
export function stageReadiness(
  stages: readonly ActivityStage[],
  situation: PipelineSituation,
  stageId: string,
): StageReadiness | null {
  const stage = stages.find((entry) => entry.id === stageId);
  if (!stage) return null;
  const byId = new Map(situation.statuses.map((status) => [status.stage.id, status]));
  const blocks: StageBlock[] = [];

  const missing = upstreamOf(stages, stageId)
    .filter((upstream) => byId.get(upstream.id)?.missing !== false)
    .map((upstream) => upstream.id);
  if (missing.length) blocks.push({ kind: "upstream_missing", stageIds: missing });

  if (stage.sharedModule && !situation.canonicalRef)
    blocks.push({ kind: "not_canonical_ref", canonicalRefNum: situation.canonicalRefNum });

  if (situation.inFlight)
    blocks.push({ kind: "run_in_flight", stageId: situation.inFlightStageId ?? null });

  return { stage, blocks };
}

/** Whether a block will still be there however long the pipeline runs. */
function permanent(block: StageBlock): boolean {
  // Missing upstream is what the plan itself fixes, and an in-flight run ends. Owning the
  // module is the only one no amount of running changes.
  return block.kind === "not_canonical_ref";
}

/**
 * The stages a whole-pipeline run intends to run, in order.
 *
 * Missing or stale, minus the ones this ref may never run at all. A stage whose upstream
 * has not run yet stays in the plan — satisfying it is what the plan is for — so the list
 * is what the run will do, not what it could do this instant.
 */
export function pipelinePlan(
  stages: readonly ActivityStage[],
  situation: PipelineSituation,
): ActivityStage[] {
  const wanted = pendingStages(situation.statuses);
  return orderedStages(
    wanted.filter((stage) => {
      const readiness = stageReadiness(stages, situation, stage.id);
      return readiness ? !readiness.blocks.some(permanent) : false;
    }),
  );
}

/**
 * The next single stage to start, or null when nothing can go right now.
 *
 * One run happens at a time per activity, so a pipeline run is a loop over this: start
 * one, and ask again when it finishes.
 */
export function nextStage(
  stages: readonly ActivityStage[],
  situation: PipelineSituation,
): ActivityStage | null {
  if (situation.inFlight) return null;
  for (const stage of pipelinePlan(stages, situation)) {
    const readiness = stageReadiness(stages, situation, stage.id);
    if (readiness && readiness.blocks.length === 0) return stage;
  }
  return null;
}

/**
 * What a completed stage invalidates, as stage ids.
 *
 * Reported, never acted on: with version snapshots out of scope, re-running these would
 * overwrite reviewed work with no way back.
 */
export function invalidatedBy(stages: readonly ActivityStage[], stageId: string): string[] {
  return downstreamOf(stages, stageId).map((stage) => stage.id);
}

/**
 * Whether an assist session may open.
 *
 * It has no stage semantics — no upstream to satisfy, no canonical-ref rule, because it
 * does not claim to produce a stage's output. The one limit is the server's: a single run
 * per activity at a time.
 */
export function assistBlocks(situation: PipelineSituation): StageBlock[] {
  return situation.inFlight
    ? [{ kind: "run_in_flight", stageId: situation.inFlightStageId ?? null }]
    : [];
}
