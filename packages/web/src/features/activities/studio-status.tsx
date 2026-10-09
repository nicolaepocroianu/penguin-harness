/**
 * The state marks in the activity header: how far the activity has come, step by step; a
 * proposal waiting on the author; and the run in flight, which opens the panel that follows it
 * rather than only naming it.
 */
import type { ActivityDetail, ActivityRunSummary } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { toneDot, toneInk, type Tone } from "../../lib/tone";
import { LiveDuration } from "../chat/live-duration";
import { runTitle } from "./sessions-panel";
import type { StudioPanel, WorkspaceSection } from "./workspace-model";

const DRAFT_TONE: Record<ActivityDetail["draft"]["status"], Tone> = {
  draft: "muted",
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

/** What the progress steps read: the draft's state and how far the build has come. */
export interface ProgressFacts {
  status: ActivityDetail["draft"]["status"];
  scriptDirty: boolean;
  specDirty: boolean;
  /** Clips with files, of all the plan holds; null before there is a plan. */
  media: { bound: number; total: number } | null;
  hasModule: boolean;
}

interface ProgressStep {
  section: WorkspaceSection;
  label: string;
  state: string;
  tone: Tone;
}

export function progressSteps(facts: ProgressFacts): ProgressStep[] {
  const words = S.activities.progress;
  const media = facts.media;
  return [
    {
      section: "description",
      label: words.script,
      state: facts.scriptDirty ? words.unsaved : words.saved,
      tone: facts.scriptDirty ? "attention" : "success",
    },
    {
      section: "specification",
      label: words.spec,
      state: facts.specDirty ? words.unsaved : S.activities.draftStatus[facts.status],
      tone: facts.specDirty ? "attention" : DRAFT_TONE[facts.status],
    },
    {
      section: "scenes",
      label: words.media,
      state: media ? words.clips(media.bound, media.total) : words.noPlan,
      tone: !media || !media.total ? "muted" : media.bound < media.total ? "attention" : "success",
    },
    {
      section: "module",
      label: words.module,
      state: facts.hasModule ? words.built : words.notBuilt,
      tone: facts.hasModule ? "success" : "muted",
    },
  ];
}

/**
 * The activity's way from script to module, one step each, in the header: each says where it
 * stands and opens its section. It takes the place of the single draft pill, whose state is
 * the Spec step's.
 */
export function ProgressSteps({
  facts,
  canOpen,
  onOpen,
}: {
  facts: ProgressFacts;
  /** Whether a step's section can be opened yet. */
  canOpen: (section: WorkspaceSection) => boolean;
  onOpen: (section: WorkspaceSection) => void;
}) {
  return (
    <ol
      aria-label={S.activities.progress.label}
      aria-live="polite"
      className="flex shrink-0 flex-wrap items-center gap-0.5"
    >
      {progressSteps(facts).map((step, index) => (
        <li key={step.section} className="flex items-center">
          {index > 0 && (
            <span aria-hidden className="mx-0.5 h-px w-2 bg-gray-300 dark:bg-gray-700" />
          )}
          <button
            type="button"
            disabled={!canOpen(step.section)}
            onClick={() => onOpen(step.section)}
            className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs whitespace-nowrap text-gray-700 hover:bg-gray-100 disabled:cursor-default disabled:hover:bg-transparent dark:text-gray-300 dark:hover:bg-gray-900"
          >
            <span
              aria-hidden
              className={`size-1.5 shrink-0 rounded-full ${
                step.tone === "muted"
                  ? "border border-gray-400 dark:border-gray-500"
                  : toneDot[step.tone]
              }`}
            />
            {step.label}
            <span
              className={
                step.tone === "muted" ? "text-gray-500 dark:text-gray-400" : toneInk[step.tone]
              }
            >
              {step.state}
            </span>
          </button>
        </li>
      ))}
    </ol>
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
