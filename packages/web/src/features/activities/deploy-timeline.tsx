import type { DeployStage } from "@prismshadow/penguin-server/api";
import { Button } from "../../components/ui/button";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { ICON_SIZE } from "../../lib/icon-scale";
import { S } from "../../lib/strings";
import { toneDot, toneInk, toneSurface } from "../../lib/tone";
import type { DeployPhase, StageRow } from "./deploy-model";

/** A hollow mark: the stage has not run, which is said by shape rather than in words. */
export const NOT_RUN_MARK = `border border-current ${toneInk.muted}`;

/** Whether a stage has simply not run yet: nothing failed, nothing blocks it. */
export function notRunYet(row: Pick<StageRow, "status" | "tone">): boolean {
  return row.status === "pending" && row.tone === "muted";
}

/**
 * The QA lane's stages in their three phases, one under the other: each phase with its
 * progress, and its stages with their marks. Under "Run one stage" every stage offers its own
 * run, with why it cannot run now. `said` is a blocker the lane already states beside its
 * button, which a stage does not repeat.
 */
export function DeployTimeline({
  phases,
  advanced,
  disabled,
  said = null,
  onRun,
}: {
  phases: readonly DeployPhase[];
  advanced: boolean;
  disabled: boolean;
  said?: string | null;
  onRun: (stage: DeployStage) => void;
}) {
  const words = S.activities.deploy;
  return (
    <ol aria-label={words.stagesLabel} className="space-y-4">
      {phases.map((phase) => (
        <li
          key={phase.key}
          aria-labelledby={`deploy-phase-${phase.key}`}
          className="min-w-0 space-y-2"
        >
          <div className="flex items-center gap-2">
            <h5
              id={`deploy-phase-${phase.key}`}
              className="min-w-0 flex-1 text-xs font-semibold text-gray-600 dark:text-gray-300"
            >
              {words.phaseLabels[phase.key]}
            </h5>
            <span aria-hidden className="text-xs tabular-nums text-gray-500 dark:text-gray-400">
              {words.phaseCount(phase.done, phase.rows.length)}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label={words.phaseLabels[phase.key]}
            aria-valuemin={0}
            aria-valuemax={phase.rows.length}
            aria-valuenow={phase.done}
            aria-valuetext={words.stageProgress(phase.done, phase.rows.length)}
            className="flex gap-1"
          >
            {phase.rows.map((row) => (
              <span
                key={row.stage}
                aria-hidden
                className={`h-1 flex-1 rounded-full ${row.tone === "muted" ? "bg-gray-200 dark:bg-gray-800" : toneDot[row.tone]}`}
              />
            ))}
          </div>
          <StageList
            rows={phase.rows}
            advanced={advanced}
            disabled={disabled}
            said={said}
            onRun={onRun}
          />
        </li>
      ))}
    </ol>
  );
}

/** Stages as a list, each with its mark; the PROD lane lists its two this way too. */
export function StageList({
  rows,
  advanced = false,
  disabled = true,
  said = null,
  onRun,
  label,
}: {
  rows: readonly StageRow[];
  advanced?: boolean;
  disabled?: boolean;
  said?: string | null;
  onRun?: (stage: DeployStage) => void;
  label?: string;
}) {
  return (
    <ol aria-label={label} className="space-y-0.5">
      {rows.map((row) => (
        <StageItem
          key={row.stage}
          row={row}
          advanced={advanced && !!onRun}
          disabled={disabled}
          said={said}
          onRun={(stage) => onRun?.(stage)}
        />
      ))}
    </ol>
  );
}

function StageItem({
  row,
  advanced,
  disabled,
  said,
  onRun,
}: {
  row: StageRow;
  advanced: boolean;
  disabled: boolean;
  said: string | null;
  onRun: (stage: DeployStage) => void;
}) {
  const words = S.activities.deploy;
  // A stage that wants a look (running, failed, stopped or blocked) is set apart from the
  // quiet ones by a tinted row as well as its words.
  const marked = row.tone !== "muted" && row.status !== "done";
  // Why the stage the pipeline stopped at cannot run is worth reading without asking for it,
  // unless the lane already says it beside its button.
  const showBlocker =
    advanced ||
    (marked && row.status === "pending" && row.blocker !== null && row.blocker !== said);
  // A stage that has not run and waits on nothing is the normal case before a deploy: its
  // hollow mark says so, and its words are for whoever cannot see the mark.
  const quiet = notRunYet(row);
  return (
    <li
      aria-label={row.label}
      aria-current={row.status === "running" ? "step" : undefined}
      className={`rounded-md px-2 py-1 ${marked ? toneSurface[row.tone] : ""}`}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden className={`flex shrink-0 ${toneInk[row.tone]}`}>
          {row.status === "done" ? (
            <GlyphIcon size={ICON_SIZE.inlineGlyph} d="m5 12 4 4L19 6" />
          ) : row.status === "failed" ? (
            <GlyphIcon size={ICON_SIZE.inlineGlyph} d="m7 7 10 10M17 7 7 17" />
          ) : row.status === "running" ? (
            <GlyphIcon
              size={ICON_SIZE.inlineGlyph}
              className="motion-safe:animate-spin"
              d="M12 3a9 9 0 1 1-9 9"
            />
          ) : (
            <span
              className={`m-1 size-1.5 rounded-full ${quiet ? NOT_RUN_MARK : toneDot[row.tone]}`}
            />
          )}
        </span>
        <span className="min-w-0 flex-1 text-sm">{row.label}</span>
        {row.detail && (
          <span className="text-xs tabular-nums text-gray-500 dark:text-gray-400">
            {row.detail}
          </span>
        )}
        <span className={quiet ? "sr-only" : `shrink-0 text-xs ${toneInk[row.tone]}`}>
          {row.statusText}
        </span>
      </div>
      {row.error && <p className={`mt-1 break-words text-xs ${toneInk.danger}`}>{row.error}</p>}
      {showBlocker && (
        <div className="mt-1 flex items-start justify-between gap-3">
          <p
            id={`deploy-blocker-${row.stage}`}
            className="text-xs text-gray-500 dark:text-gray-400"
          >
            {row.blocker}
          </p>
          {advanced && (
            <Button
              size="sm"
              aria-label={words.runStage(row.label)}
              aria-describedby={row.blocker ? `deploy-blocker-${row.stage}` : undefined}
              disabled={disabled || row.blocker !== null}
              onClick={() => onRun(row.stage)}
            >
              {words.run}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
