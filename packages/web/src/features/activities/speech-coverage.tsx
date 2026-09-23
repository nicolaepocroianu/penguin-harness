/**
 * What narration one language still needs, and one way to ask for all of it. The list
 * and the button are driven by the same pure model, so the count an author reads is
 * exactly the work the button starts.
 */
import { useState } from "react";
import type { ActivityRunSummary, AssetManifest } from "@prismshadow/penguin-server/api";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { InfoPopover } from "../../components/ui/info-popover";
import { S } from "../../lib/strings";
import { toneInk, type Tone } from "../../lib/tone";
import {
  inSpeechFilter,
  pendingSpeechKeys,
  speechStatuses,
  speechTally,
  type SpeechFilter,
  type SpeechState,
} from "./bulk-speech";

const STATE_TONE: Record<SpeechState, Tone | null> = {
  ready: null,
  generating: "busy",
  failed: "danger",
  missing: "attention",
  scriptMissing: "attention",
  scriptTooLong: "attention",
};

const FILTERS: readonly SpeechFilter[] = ["all", "needs", "failed", "ready", "blocked"];

type MediaAsset = AssetManifest["assets"][string][number];

export function SpeechCoverage({
  assets,
  language,
  editable,
  canGenerate,
  onSelect,
  onGenerateAll,
  queued,
  onCancelQueue,
  runs = [],
  languages = [],
  onLanguage,
  onRetry,
}: {
  assets: readonly MediaAsset[];
  language: string;
  /** The activity's runs, which say what is generating and what failed. */
  runs?: readonly ActivityRunSummary[];
  /** Every language's bound and total narration, for switching between them. */
  languages?: readonly { language: string; ready: number; total: number }[];
  onLanguage?: (language: string) => void;
  /** Generate one narration again after it failed. */
  onRetry?: (key: string) => void;
  editable: boolean;
  canGenerate: boolean;
  /** Open one narration in the workbench's detail panel. */
  onSelect: (key: string) => void;
  onGenerateAll: (keys: string[]) => void;
  /** How many narrations are still queued; 0 when no bulk run is in flight. */
  queued: number;
  onCancelQueue: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [filter, setFilter] = useState<SpeechFilter>("all");
  const statuses = speechStatuses(assets, runs, language);
  const tally = speechTally(assets, runs, language);
  const pending = pendingSpeechKeys(assets, runs, language);
  const counts = Object.fromEntries(
    FILTERS.map((entry) => [entry, statuses.filter((s) => inSpeechFilter(s, entry)).length]),
  ) as Record<SpeechFilter, number>;
  const shown = statuses.filter((status) => inSpeechFilter(status, filter));
  if (!tally.total) return <p className="text-sm text-gray-500">{S.activities.bulkSpeechNone}</p>;
  return (
    <section className="space-y-3">
      <h4 className="flex items-center gap-2 text-sm font-semibold">
        {S.activities.bulkSpeechTitle}
        <InfoPopover label={S.activities.bulkSpeechTitle}>
          <p>{S.activities.bulkSpeechHelp}</p>
        </InfoPopover>
      </h4>
      <p className="text-xs text-gray-500">
        {S.activities.bulkSpeechTally(tally.ready, tally.total)}
        {tally.pending > 0 ? ` · ${S.activities.bulkSpeechPending(tally.pending)}` : ""}
      </p>
      {tally.blocked > 0 && (
        <p className={`text-xs ${toneInk.attention}`}>
          {S.activities.bulkSpeechBlocked(tally.blocked)}
        </p>
      )}
      {languages.length > 1 && onLanguage && (
        <div
          role="group"
          aria-label={S.activities.bulkSpeechLanguages}
          className="flex flex-wrap gap-1"
        >
          {languages.map((entry) => (
            <button
              key={entry.language}
              type="button"
              aria-pressed={entry.language === language}
              onClick={() => onLanguage(entry.language)}
              className={`rounded-md border px-2 py-0.5 text-xs tabular-nums ${
                entry.language === language
                  ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-200"
                  : "border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
              }`}
            >
              {S.activities.bulkSpeechLanguage(entry.language, entry.ready, entry.total)}
            </button>
          ))}
        </div>
      )}
      <div
        role="group"
        aria-label={S.activities.bulkSpeechFilters}
        className="flex flex-wrap gap-1"
      >
        {FILTERS.filter((entry) => entry === "all" || counts[entry] > 0).map((entry) => (
          <button
            key={entry}
            type="button"
            aria-pressed={filter === entry}
            onClick={() => setFilter(entry)}
            className={`rounded-full px-2 py-0.5 text-xs ${
              filter === entry
                ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            }`}
          >
            {S.activities.bulkSpeechFilter[entry]}{" "}
            <span className="tabular-nums opacity-70">{counts[entry]}</span>
          </button>
        ))}
      </div>
      <ul className="space-y-1">
        {shown.map((status) => {
          const tone = STATE_TONE[status.state];
          return (
            <li key={status.key} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onSelect(status.key)}
                title={status.error}
                className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-gray-50 dark:hover:bg-gray-900"
              >
                <span className="min-w-0 break-all">
                  <span className="font-medium">{status.key}</span>
                  <span className="text-gray-500"> · {status.sceneIds.join(", ")}</span>
                </span>
                <span className={`shrink-0 ${tone ? toneInk[tone] : "text-gray-500"}`}>
                  {S.activities.speechState[status.state]}
                </span>
              </button>
              {status.state === "failed" && editable && onRetry && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!canGenerate}
                  onClick={() => onRetry(status.key)}
                >
                  {S.activities.bulkSpeechRetry}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {editable && queued > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="status" className={`text-xs ${toneInk.busy}`}>
            {S.activities.bulkSpeechQueued(queued)}
          </p>
          <Button size="sm" onClick={onCancelQueue}>
            {S.activities.bulkSpeechStop}
          </Button>
        </div>
      ) : (
        editable &&
        pending.length > 0 && (
          <Button size="sm" disabled={!canGenerate} onClick={() => setConfirming(true)}>
            {S.activities.bulkSpeechGenerate(pending.length)}
          </Button>
        )
      )}
      {confirming && (
        <ConfirmModal
          open
          tone="primary"
          title={S.activities.bulkSpeechTitle}
          confirmLabel={S.activities.bulkSpeechGenerate(pending.length)}
          onClose={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onGenerateAll(pending);
          }}
        >
          <p>{S.activities.bulkSpeechConfirm(pending.length, language)}</p>
        </ConfirmModal>
      )}
    </section>
  );
}
