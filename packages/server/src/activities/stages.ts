/**
 * The generation pipeline as a registry rather than a hard-coded sequence.
 *
 * Loom keeps its canonical stage order in a string array inside an Angular component, with
 * the caller free to pass any list it likes — the UI is the source of truth for pipeline
 * semantics. That is the one piece of Loom's design deliberately not ported. Here a stage
 * declares itself as data through a kernel slot, the same mechanism that already assembles
 * HTTP routes, sandbox providers and messaging connectors, and the server owns the order.
 *
 * The functions below are pure so the graph can be checked without running anything: the
 * ordering, the dependency closure that decides what a re-run invalidates, and the cycle
 * check that stops a bad contribution from being discovered at generation time.
 */

/** How a stage does its work. */
export type StageExecution =
  /** An agent Session in a workspace: prompts, tools, approvals. */
  | "agent"
  /** Ordinary server code, possibly calling a provider over HTTP. No workspace, no approvals. */
  | "deterministic";

/** The data half of a stage contribution: what it is and where it sits. */
export interface ActivityStageConfig {
  /** Position in the pipeline. Sorted with the id as a stable tiebreak. */
  order: number;
  execution: StageExecution;
  /**
   * Stages whose output this one consumes. Re-running one of those marks this stale; it is
   * never re-run automatically, because with no version history an overwrite is final.
   */
  dependsOn: readonly string[];
  /**
   * Whether this stage changes the module code the product's refs share. Only the
   * canonical ref may run one of these.
   */
  sharedModule?: boolean;
}

/** A stage as the registry hands it out: its id plus what it declared. */
export interface ActivityStage extends ActivityStageConfig {
  id: string;
}

/**
 * The pipeline in order.
 *
 * `order` decides, and the id breaks ties, so two stages contributing the same number
 * still produce one stable sequence rather than depending on load order.
 */
export function orderedStages(stages: readonly ActivityStage[]): ActivityStage[] {
  return [...stages].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** The stages that consume `id` directly. */
export function dependentsOf(stages: readonly ActivityStage[], id: string): ActivityStage[] {
  return orderedStages(stages.filter((stage) => stage.dependsOn.includes(id)));
}

/**
 * Everything downstream of `id`, transitively, excluding `id` itself.
 *
 * This is what a re-run invalidates. It is a closure rather than one hop because a stage
 * two steps away is just as wrong: regenerating the specification leaves the assembled
 * module describing scenes that no longer exist.
 */
export function downstreamOf(stages: readonly ActivityStage[], id: string): ActivityStage[] {
  const byId = new Map(stages.map((stage) => [stage.id, stage]));
  if (!byId.has(id)) return [];
  const seen = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const current = queue.shift()!;
    for (const stage of stages) {
      if (!stage.dependsOn.includes(current)) continue;
      if (seen.has(stage.id)) continue;
      seen.add(stage.id);
      queue.push(stage.id);
    }
  }
  // A cycle would put `id` in its own closure; it is not downstream of itself.
  seen.delete(id);
  return orderedStages([...seen].map((each) => byId.get(each)!));
}

/** Stages that must have run before `id` can, transitively. */
export function upstreamOf(stages: readonly ActivityStage[], id: string): ActivityStage[] {
  const byId = new Map(stages.map((stage) => [stage.id, stage]));
  const seen = new Set<string>();
  const queue = [...(byId.get(id)?.dependsOn ?? [])];
  while (queue.length) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    // A dependency naming a stage nobody contributed is reported by `registryProblems`,
    // not silently treated as satisfied here.
    if (!byId.has(current)) continue;
    seen.add(current);
    queue.push(...byId.get(current)!.dependsOn);
  }
  seen.delete(id);
  return orderedStages([...seen].map((each) => byId.get(each)!));
}

/**
 * What is wrong with the registry, as messages, or an empty list.
 *
 * Checked once at assembly rather than when a run starts: a dependency naming a stage
 * nobody contributed, or a cycle, is a wiring mistake, and finding it the first time an
 * author presses Generate is finding it in the worst possible place.
 */
export function registryProblems(stages: readonly ActivityStage[]): string[] {
  const problems: string[] = [];
  const byId = new Map<string, ActivityStage>();
  for (const stage of stages) {
    if (byId.has(stage.id)) problems.push(`Two stages share the id "${stage.id}".`);
    byId.set(stage.id, stage);
  }
  for (const stage of stages)
    for (const dependency of stage.dependsOn)
      if (!byId.has(dependency))
        problems.push(`Stage "${stage.id}" depends on "${dependency}", which no stage provides.`);

  // Depth-first, tracking the path, so the message can name the cycle rather than just
  // asserting there is one.
  const state = new Map<string, "open" | "closed">();
  const path: string[] = [];
  const walk = (id: string): void => {
    const mark = state.get(id);
    if (mark === "closed") return;
    if (mark === "open") {
      const from = path.indexOf(id);
      problems.push(`Stages form a cycle: ${[...path.slice(from), id].join(" -> ")}.`);
      return;
    }
    state.set(id, "open");
    path.push(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) walk(dependency);
    path.pop();
    state.set(id, "closed");
  };
  for (const stage of stages) walk(stage.id);
  return problems;
}

/**
 * A stage ordered after everything it depends on, or the ones that are not.
 *
 * Declared order and declared dependencies are two statements about the same thing, and
 * they can disagree. Rather than silently preferring one, this reports the disagreement.
 */
export function misorderedStages(stages: readonly ActivityStage[]): string[] {
  const byId = new Map(stages.map((stage) => [stage.id, stage]));
  const problems: string[] = [];
  for (const stage of stages)
    for (const dependency of stage.dependsOn) {
      const upstream = byId.get(dependency);
      if (!upstream) continue;
      if (upstream.order >= stage.order)
        problems.push(
          `Stage "${stage.id}" (order ${stage.order}) depends on "${dependency}" (order ${upstream.order}), which does not run earlier.`,
        );
    }
  return problems;
}

/** What a completed stage left behind: when it finished and what it was reading. */
export interface StageCompletion {
  stageId: string;
  /** ISO timestamp; compared against upstream completions. */
  finishedAt: string;
  /** The draft revision this run consumed, the same value module preview already uses. */
  inputRevision: string;
}

export interface StageStatus {
  stage: ActivityStage;
  /** No completion on record: never run, or its run was discarded. */
  missing: boolean;
  /** Ran, but against something that has since moved. */
  stale: boolean;
  /** Why it is stale, for a notice an author can act on. Empty when it is not. */
  reasons: string[];
}

/**
 * Which stages still describe the activity as it is now.
 *
 * Two ways to fall behind. The draft moved under a stage, which the existing
 * `inputRevision` comparison already expresses for the module preview; or a stage it
 * depends on ran again afterwards, which is the case per-stage re-runs introduce.
 *
 * Nothing here re-runs anything. With version snapshots out of scope there is no undo, so
 * an automatic cascade would overwrite work an author had already reviewed and accepted
 * with no way back. Saying what is stale is the whole job.
 */
export function stageStatuses(
  stages: readonly ActivityStage[],
  completions: readonly StageCompletion[],
  currentRevision: string,
): StageStatus[] {
  const done = new Map(completions.map((completion) => [completion.stageId, completion]));
  return orderedStages(stages).map((stage) => {
    const completion = done.get(stage.id);
    if (!completion) return { stage, missing: true, stale: false, reasons: [] };
    const reasons: string[] = [];
    if (completion.inputRevision !== currentRevision) reasons.push("the draft changed since");
    for (const upstream of upstreamOf(stages, stage.id)) {
      const ran = done.get(upstream.id);
      if (ran && ran.finishedAt > completion.finishedAt) reasons.push(`${upstream.id} ran again`);
    }
    return { stage, missing: false, stale: reasons.length > 0, reasons };
  });
}

/** The stages a whole-pipeline run would start, in order: the missing and the stale. */
export function pendingStages(statuses: readonly StageStatus[]): ActivityStage[] {
  return statuses.filter((status) => status.missing || status.stale).map((status) => status.stage);
}
