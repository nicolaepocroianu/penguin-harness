/**
 * The chips in the activity header beside the journey: a proposal waiting on the author, and
 * the run in flight, which opens where that run is followed rather than only naming it.
 */
import type { ActivityRunSummary } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { toneInk, toneName } from "../../lib/tone";
import { Dot, GlyphIcon, ICON_SIZE, LiveDuration } from "@prismshadow/penguin-ui";
import { MARK_PATH } from "./journey-header";
import { runKindLabel } from "./run-toasts";
import type { StudioPanel } from "./workspace-model";

/** Where a run is followed: one of the right-edge tools, or its transcript in History. */
export type RunFollow = { kind: "tool"; tool: StudioPanel } | { kind: "history"; runId: string };

/**
 * Tests and quality are followed in Checks, a conversation in Chat. Stages follows the running
 * sequence's own sessions, so it is only where to look while a sequence runs; a run started on
 * its own (an Assemble pressed in Module) has its transcript in History.
 */
const RUN_TOOL: Partial<Record<ActivityRunSummary["kind"], StudioPanel>> = {
  test: "checks",
  quality: "checks",
  assist: "conversation",
};

export function runFollow(run: ActivityRunSummary, pipelineRunning: boolean): RunFollow {
  const tool = RUN_TOOL[run.kind] ?? (pipelineRunning ? "run" : null);
  return tool ? { kind: "tool", tool } : { kind: "history", runId: run.runId };
}

/**
 * The run in flight: what it is and how long it has gone. When the header is narrow it keeps
 * its dot and its time, and the words go to a reader.
 */
export function RunningChip({ run, onFollow }: { run: ActivityRunSummary; onFollow: () => void }) {
  const started = Date.parse(run.createdAt);
  return (
    <button
      type="button"
      data-tooltip={S.activities.followRun}
      onClick={onFollow}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-current/20 px-2 py-0.5 text-xs whitespace-nowrap hover:bg-gray-50 dark:hover:bg-gray-900 ${toneInk.busy}`}
    >
      <Dot tone={toneName.busy} pulse />
      <span className="@max-3xl:sr-only">{S.activities.runningChip(runKindLabel(run))}</span>
      {Number.isFinite(started) && (
        <span className="font-mono tabular-nums text-gray-500 dark:text-gray-400">
          <LiveDuration sinceMs={started} />
        </span>
      )}
    </button>
  );
}

/**
 * The agent proposed a script that is still waiting on the author; it opens the review. Its
 * lead is the journey's alert mark rather than a dot, so on a narrow header, where the words go
 * to a reader, its shape still says something waits.
 */
export function ProposalWaiting({ onReview }: { onReview: () => void }) {
  return (
    <button
      type="button"
      data-tooltip={S.activities.journey.proposalWaiting}
      onClick={onReview}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-current/20 px-2 py-0.5 text-xs whitespace-nowrap hover:bg-gray-50 dark:hover:bg-gray-900 ${toneInk.attention}`}
    >
      <GlyphIcon d={MARK_PATH.attention} size={ICON_SIZE.inlineGlyph} />
      <span className="@max-3xl:sr-only">{S.activities.journey.proposalWaiting}</span>
    </button>
  );
}
