/**
 * The stage registry as a kernel slot.
 *
 * A stage contributes itself the way HTTP route groups, sandbox backends and messaging
 * connectors already do: the declaration as pure data, the work as the code half, bound by
 * id. Adding a stage is adding a contribution, not editing a list — which is the whole
 * difference from Loom, where the canonical order lives in an Angular component and the
 * caller passes whatever stage names it likes.
 *
 * The registry checks itself once, at assembly. A cycle, a dependency naming a stage
 * nobody provides, or an order disagreeing with its dependencies is a wiring mistake, and
 * discovering it the first time an author presses Generate is discovering it in the worst
 * possible place.
 */
import {
  Interface,
  Module,
  Provide,
  type ClassCtx,
  type Opaque,
  type Slot,
} from "@prismshadow/penguin-core/kernel";
import {
  misorderedStages,
  orderedStages,
  registryProblems,
  type ActivityStage,
  type ActivityStageConfig,
} from "./stages.js";

/** What a stage is handed, and what it is expected to leave behind. */
export interface StageContext {
  projectId: string;
  activityId: string;
  /** The draft revision this run is reading; recorded so staleness can be judged later. */
  inputRevision: string;
  /** The run's own directory, the only place a deterministic stage may write. */
  workspace: string;
  /**
   * The shared WAF checkout, when one was resolved for this run. Read-only: the module
   * scaffold compiles against the framework in it and must leave it unchanged.
   */
  wafRoot?: string;
  /** Which reading mode a book activity was started for; absent for a standard one. */
  bookMode?: "decodable" | "readAlong";
}

export interface StageOutcome {
  /** What the stage did, for the run's record. One line, in an author's words. */
  summary: string;
  /**
   * What it could not do. A stage reports a missing capability rather than succeeding
   * quietly: a manifest with unbound assets is not a complete manifest.
   */
  problems?: string[];
}

/** The code half of a stage contribution. */
export interface StageRunner {
  run(context: StageContext): Promise<StageOutcome>;
}

export abstract class ActivityStages extends Interface<{
  /** The pipeline, in order, already checked. */
  all(): readonly ActivityStage[];
  /** One stage's declaration, or undefined when nothing provides it. */
  get(id: string): ActivityStage | undefined;
  /**
   * The code half for a stage, or undefined when only its declaration exists.
   *
   * Opaque because a runner is an object with a method, and the interface contract is
   * compared by name across the push boundary rather than expanded structurally.
   */
  runner(id: string): Opaque<"StageRunner"> | undefined;
}>() {}

export interface ActivityStagesSlots {
  /**
   * One generation stage. The data half is its declaration — where it sits, whether it
   * needs an agent, what it reads, whether it writes the shared module — and the code half
   * is what runs it.
   */
  stages: Slot<
    {
      order: number;
      execution: "agent" | "deterministic";
      dependsOn: string[];
      sharedModule?: boolean;
    },
    Opaque<"StageRunner">
  >;
}

@Module()
export class ActivityStagesModule {
  @Provide() stages!: ActivityStages;

  setup({ contributions }: ClassCtx) {
    const declared: ActivityStage[] = (contributions.stages ?? []).map((entry) => ({
      id: entry.id,
      order: entry.data.order as number,
      execution: entry.data.execution as ActivityStage["execution"],
      dependsOn: (entry.data.dependsOn as string[] | undefined) ?? [],
      ...(entry.data.sharedModule === true ? { sharedModule: true } : {}),
    }));
    const runners = new Map<string, StageRunner>(
      (contributions.stages ?? []).map((entry) => [entry.id, entry.code as StageRunner]),
    );

    const problems = [...registryProblems(declared), ...misorderedStages(declared)];
    if (problems.length)
      throw new Error(`The activity stage registry is not sound:\n  ${problems.join("\n  ")}`);

    const all = orderedStages(declared);
    const byId = new Map(all.map((stage) => [stage.id, stage]));
    this.stages = {
      all: () => all,
      get: (id) => byId.get(id),
      // The interface hands out an opaque handle -- compared by name across the push
      // boundary, never expanded -- so the caller casts it back to a runner.
      runner: (id) => runners.get(id) as Opaque<"StageRunner"> | undefined,
    };
  }
}
