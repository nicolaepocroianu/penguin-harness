/**
 * The state marks in the activity header: how far the activity has come, step by step, with
 * the one to do next and a button that goes there; a proposal waiting on the author; and the
 * run in flight, which opens the panel that follows it rather than only naming it.
 */
import type {
  ActivityDetail,
  ActivityRunSummary,
  DeployStateResponse,
} from "@prismshadow/penguin-server/api";
import { Button } from "../../components/ui/button";
import { S } from "../../lib/strings";
import { toneDot, toneInk, toneStrip, type Tone } from "../../lib/tone";
import { LiveDuration } from "../chat/live-duration";
import { isProdRun, isQaRun, qaResult } from "./deploy-model";
import { runTitle } from "./sessions-panel";
import type { StudioPanel, WorkspaceSection } from "./workspace-model";

/** Where the activity stands on QA, as the header's last progress step reads it. */
export type QaFact = "deployed" | "deploying" | "failed" | "none";

/**
 * The QA step from the deploy state the Deploy section also reads: a QA deploy running now,
 * a finished one (which survives a reload in the stored stages), the latest QA run having
 * failed, or none of those.
 */
export function qaFact(state: Pick<DeployStateResponse, "run" | "stages">): QaFact {
  const run = state.run;
  const qaRun = run && isQaRun(run) && !isProdRun(run) ? run : null;
  if (qaRun?.status === "running") return "deploying";
  if (qaResult(state.stages)) return "deployed";
  if (qaRun?.status === "failed") return "failed";
  return "none";
}

const DRAFT_TONE: Record<ActivityDetail["draft"]["status"], Tone> = {
  draft: "attention",
  valid: "success",
  invalid: "danger",
};

/**
 * Where each kind of run is followed. Stages follows the running sequence's own sessions, so
 * it is only where to look while a sequence runs; a run started on its own (an Assemble
 * pressed in Build) has its transcript in Sessions.
 */
const RUN_PANEL: Partial<Record<ActivityRunSummary["kind"], StudioPanel>> = {
  test: "tests",
  quality: "quality",
  assist: "conversation",
};

export function runPanel(run: ActivityRunSummary, pipelineRunning: boolean): StudioPanel {
  return RUN_PANEL[run.kind] ?? (pipelineRunning ? "run" : "sessions");
}

export function RunningChip({ run, onFollow }: { run: ActivityRunSummary; onFollow: () => void }) {
  const started = Date.parse(run.createdAt);
  return (
    <button
      type="button"
      title={S.activities.followRun}
      onClick={onFollow}
      className={`ml-1 inline-flex shrink-0 items-center gap-1.5 rounded-full border border-current/20 px-2 py-0.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-900 ${toneInk.busy}`}
    >
      <span aria-hidden className={`size-1.5 animate-pulse rounded-full ${toneDot.busy}`} />
      {S.activities.runningChip(runTitle(run.kind))}
      {Number.isFinite(started) && (
        <span className="font-mono tabular-nums text-gray-500 dark:text-gray-400">
          <LiveDuration sinceMs={started} />
        </span>
      )}
      <span aria-hidden>›</span>
    </button>
  );
}

/** What the progress steps read: the draft's state and how far the build and deploy have come. */
export interface ProgressFacts {
  status: ActivityDetail["draft"]["status"];
  scriptDirty: boolean;
  specDirty: boolean;
  /** Clips with files, of all the plan holds; null before there is a plan. */
  media: { bound: number; total: number } | null;
  /** Kept scene videos whose final check found something to fix. */
  videosToCheck?: number;
  hasModule: boolean;
  /** Where the activity stands on QA; null until the deploy state has been read. */
  qa: QaFact | null;
}

/** Where a step's next action is done: a section of the work, or a side panel. */
export type NextTarget =
  { kind: "section"; section: WorkspaceSection } | { kind: "panel"; panel: StudioPanel };

export interface ProgressStep {
  section: WorkspaceSection;
  label: string;
  state: string;
  tone: Tone;
  /** What to do here next and where; null once the step is done, while it runs, or when unknown. */
  todo: { action: string; go: NextTarget } | null;
}

const section = (section: WorkspaceSection): NextTarget => ({ kind: "section", section });

/**
 * The Media step: how many clips have files; once all do, whether a kept scene video failed its
 * final check and wants a look.
 */
function mediaStep(media: ProgressFacts["media"], videosToCheck: number): ProgressStep {
  const words = S.activities.progress;
  const act = words.actions;
  const base = { section: "scenes" as const, label: words.media };
  if (!media)
    return {
      ...base,
      state: words.noPlan,
      tone: "muted",
      todo: { action: act.planMedia, go: section("scenes") },
    };
  if (media.bound < media.total)
    return {
      ...base,
      state: words.clips(media.bound, media.total),
      tone: "attention",
      todo: { action: act.finishMedia, go: section("scenes") },
    };
  if (videosToCheck > 0)
    return {
      ...base,
      state: words.videosToCheck(videosToCheck),
      tone: "attention",
      todo: { action: act.checkVideos, go: section("scenes") },
    };
  return {
    ...base,
    state: words.clips(media.bound, media.total),
    tone: media.total ? "success" : "muted",
    todo: null,
  };
}

export function progressSteps(facts: ProgressFacts): ProgressStep[] {
  const words = S.activities.progress;
  const act = words.actions;
  const media = facts.media;
  const specTodo = facts.specDirty
    ? act.saveSpec
    : facts.status === "draft"
      ? act.validateSpec
      : facts.status === "invalid"
        ? act.fixSpec
        : null;
  const qaState: Record<QaFact, { state: string; tone: Tone; todo: boolean }> = {
    deployed: { state: words.qaDeployed, tone: "success", todo: false },
    deploying: { state: words.qaDeploying, tone: "busy", todo: false },
    failed: { state: words.qaFailed, tone: "danger", todo: true },
    none: { state: words.qaNotDeployed, tone: "muted", todo: true },
  };
  const qa = facts.qa ? qaState[facts.qa] : null;
  return [
    {
      section: "description",
      label: words.script,
      state: facts.scriptDirty ? words.unsaved : words.saved,
      tone: facts.scriptDirty ? "attention" : "success",
      todo: facts.scriptDirty ? { action: act.saveScript, go: section("description") } : null,
    },
    {
      section: "specification",
      label: words.spec,
      state: facts.specDirty
        ? words.unsaved
        : facts.status === "draft"
          ? words.specDraft
          : S.activities.draftStatus[facts.status],
      tone: facts.specDirty ? "attention" : DRAFT_TONE[facts.status],
      todo: specTodo ? { action: specTodo, go: section("specification") } : null,
    },
    mediaStep(media, facts.videosToCheck ?? 0),
    {
      section: "module",
      label: words.module,
      state: facts.hasModule ? words.built : words.notBuilt,
      tone: facts.hasModule ? "success" : "muted",
      // A module is built by running the stages, which the Stages panel follows.
      todo: facts.hasModule
        ? null
        : { action: act.buildModule, go: { kind: "panel", panel: "run" } },
    },
    {
      section: "deploy",
      label: words.qa,
      state: qa ? qa.state : words.qaUnknown,
      tone: qa ? qa.tone : "muted",
      todo: qa?.todo ? { action: act.deployQa, go: section("deploy") } : null,
    },
  ];
}

/** The first step with something left to do: the one the header highlights and offers. */
export function nextStep(steps: readonly ProgressStep[]): ProgressStep | null {
  return steps.find((step) => step.todo !== null) ?? null;
}

/**
 * What the Next button offers: the next step's action, or nothing for a viewer who cannot
 * act on this activity (every action saves, validates, builds or deploys). The highlight
 * stays either way; it says where the activity stands, not what the viewer may do.
 */
export function nextAction(steps: readonly ProgressStep[], canAct: boolean): ProgressStep["todo"] {
  return canAct ? (nextStep(steps)?.todo ?? null) : null;
}

/**
 * The activity's way from script to QA, one step each, as one segmented bar in the header:
 * each says where it stands and opens its section, the first unfinished one stands out, and
 * a button beside the bar goes where that step is done.
 */
export function ProgressSteps({
  facts,
  canOpen,
  canAct,
  onOpen,
  onNext,
}: {
  facts: ProgressFacts;
  /** Whether a step's section can be opened yet. */
  canOpen: (section: WorkspaceSection) => boolean;
  /** Whether the viewer may do the next step's action; a member only reads. */
  canAct: boolean;
  onOpen: (section: WorkspaceSection) => void;
  /** Go where the next step is done: its section, or the panel that runs it. */
  onNext: (go: NextTarget) => void;
}) {
  const steps = progressSteps(facts);
  const next = nextStep(steps);
  const todo = nextAction(steps, canAct);
  const last = steps.length - 1;
  return (
    // Neither the bar nor its steps may refuse to shrink: on a phone the header's row is
    // narrower than five steps, and a bar held at its full width runs under the Layout menu.
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <ol
        aria-label={S.activities.progress.label}
        aria-live="polite"
        className="flex min-w-0 flex-wrap items-center"
      >
        {steps.map((step, index) => {
          const current = step === next;
          // Neighbours share one border; the highlighted step's own border wins the overlap.
          const edge = `${index > 0 ? "-ml-px" : ""} ${index === 0 ? "rounded-l-md" : ""} ${index === last ? "rounded-r-md" : ""}`;
          const surface = current
            ? `relative z-10 ${toneStrip[step.tone === "danger" ? "danger" : "attention"]}`
            : "border-gray-200 text-gray-700 hover:bg-gray-100 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-900";
          return (
            <li key={step.section} className="flex items-center">
              <button
                type="button"
                disabled={!canOpen(step.section)}
                aria-current={current ? "step" : undefined}
                onClick={() => onOpen(step.section)}
                className={`inline-flex items-center gap-1.5 border px-2 py-0.5 text-xs whitespace-nowrap disabled:cursor-default disabled:hover:bg-transparent ${edge} ${surface}`}
              >
                <span
                  aria-hidden
                  className={`size-1.5 shrink-0 rounded-full ${
                    step.tone === "muted"
                      ? "border border-gray-400 dark:border-gray-500"
                      : toneDot[step.tone]
                  }`}
                />
                <span className={current ? "font-semibold" : ""}>{step.label}</span>
                <span
                  className={
                    current
                      ? ""
                      : step.tone === "muted"
                        ? "text-gray-500 dark:text-gray-400"
                        : toneInk[step.tone]
                  }
                >
                  {step.state}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {todo && (
        <Button size="sm" variant="primary" onClick={() => onNext(todo.go)}>
          {S.activities.progress.next(todo.action)}
        </Button>
      )}
    </div>
  );
}

/** The agent proposed a script that is still waiting on the author; it opens the review. */
export function ProposalWaiting({ onReview }: { onReview: () => void }) {
  return (
    <button
      type="button"
      onClick={onReview}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-current/20 px-2 py-0.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-900 ${toneInk.attention}`}
    >
      <span aria-hidden className={`size-1.5 rounded-full ${toneDot.attention}`} />
      {S.activities.progress.proposalWaiting}
    </button>
  );
}
