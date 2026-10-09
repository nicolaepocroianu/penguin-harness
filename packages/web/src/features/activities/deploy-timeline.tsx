import type { DeployStage } from "@prismshadow/penguin-server/api";
import { Button } from "../../components/ui/button";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { ICON_SIZE } from "../../lib/icon-scale";
import { S } from "../../lib/strings";
import { toneDot, toneInk, toneSurface } from "../../lib/tone";
import type { DeployPhase, StageRow } from "./deploy-model";

/**
 * The QA pipeline in its three phases, side by side where there is room and stacked where
 * there is not: each phase with its progress, and its stages with their state in words. Under
 * "Run one stage" every stage offers its own run, with why it cannot run now.
 */
export function DeployTimeline({
  phases,
  advanced,
  disabled,
  onRun,
}: {
  phases: readonly DeployPhase[];
  advanced: boolean;
  disabled: boolean;
  onRun: (stage: DeployStage) => void;
}) {
  const words = S.activities.deploy;
  return (
    <ol
      aria-label={words.stagesLabel}
      className="grid divide-y divide-gray-200 md:grid-cols-3 md:divide-x md:divide-y-0 dark:divide-gray-800"
    >
      {phases.map((phase, index) => (
        <li
          key={phase.key}
          aria-labelledby={`deploy-phase-${phase.key}`}
          className="min-w-0 space-y-3 p-4"
        >
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="flex size-5 shrink-0 items-center justify-center rounded-full border border-gray-300 text-xs tabular-nums text-gray-500 dark:border-gray-700 dark:text-gray-400"
            >
              {index + 1}
            </span>
            <h5 id={`deploy-phase-${phase.key}`} className="min-w-0 flex-1 text-sm font-semibold">
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
          <ol className="space-y-1">
            {phase.rows.map((row) => (
              <StageItem
                key={row.stage}
                row={row}
                advanced={advanced}
                disabled={disabled}
                onRun={onRun}
              />
            ))}
          </ol>
        </li>
      ))}
    </ol>
  );
}

function StageItem({
  row,
  advanced,
  disabled,
  onRun,
}: {
  row: StageRow;
  advanced: boolean;
  disabled: boolean;
  onRun: (stage: DeployStage) => void;
}) {
  const words = S.activities.deploy;
  // A stage that wants a look (running, failed, stopped or blocked) is set apart from the
  // quiet ones by a tinted row as well as its words.
  const marked = row.tone !== "muted" && row.status !== "done";
  // Why the stage the pipeline stopped at cannot run is worth reading without asking for it.
  const showBlocker = advanced || (marked && row.status === "pending" && row.blocker !== null);
  return (
    <li
      aria-label={row.label}
      aria-current={row.status === "running" ? "step" : undefined}
      className={`rounded-md px-2 py-1.5 ${marked ? toneSurface[row.tone] : ""}`}
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
            <span className={`m-1 size-1.5 rounded-full ${toneDot[row.tone]}`} />
          )}
        </span>
        <span className="min-w-0 flex-1 text-sm">{row.label}</span>
        {row.detail && (
          <span className="text-xs tabular-nums text-gray-500 dark:text-gray-400">
            {row.detail}
          </span>
        )}
        <span className={`shrink-0 text-xs ${toneInk[row.tone]}`}>{row.statusText}</span>
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
