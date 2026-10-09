/**
 * The agent's current proposal, one change per row: what it changes and by how much, where
 * the script review stands, the diff against the saved draft, and Accept. Accepting goes
 * through the same route an author's own save does, with the same revision check, so an
 * accepted proposal is an ordinary draft change.
 */
import { useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { S } from "../../lib/strings";
import { toneDot, toneInk, toneSurface } from "../../lib/tone";
import {
  changeIsApplied,
  changeKey,
  changeLabel,
  changeTexts,
  openSummaries,
  type AssistProposal,
  type ProposalBase,
  type ProposalChange,
} from "./proposal";
import type { ScriptReview } from "./script-editor";
import { SpecDiffView } from "./spec-diff-view";

export function ProposalCard({
  proposal,
  base,
  dirty,
  onAccept,
  onApplyAll,
  onDiscard,
  review = null,
  onReviewScript,
}: {
  proposal: AssistProposal;
  base: ProposalBase;
  /** The author has unsaved edits, which accepting would overwrite. */
  dirty: boolean;
  onAccept?: (change: ProposalChange) => Promise<void>;
  /** Apply every change as one draft change, all or none. */
  onApplyAll?: () => Promise<void>;
  onDiscard?: () => Promise<void>;
  /** Where the script editor's review of the proposed script stands, while one is open. */
  review?: ScriptReview | null;
  /** Open the proposed script for review in the editor, at a scene when one is given. */
  onReviewScript?: (scene?: number) => void;
}) {
  const words = S.activities.studioProposal;
  const [accepting, setAccepting] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  // Only changes that still apply to something and have not landed yet count.
  const open = proposal.changes.filter(
    (change) => changeTexts(change, base) && !changeIsApplied(change, base),
  );
  const inDraft = proposal.changes.filter((change) => changeIsApplied(change, base)).length;
  // Diffed once per proposal and saved draft, not on every re-render: the page rebuilds the
  // base object each render, so the memo keys on what it holds.
  const { description, spec, manifest } = base;
  const summaries = useMemo(
    () => openSummaries(proposal, { description, spec, manifest }),
    [proposal, description, spec, manifest],
  );
  const footer = (onApplyAll && open.length > 0) || onDiscard;
  return (
    <section
      aria-label={words.title}
      className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950"
    >
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 dark:border-gray-800/60">
        <span
          aria-hidden
          className={`size-1.5 shrink-0 rounded-full ${open.length ? toneDot.attention : toneDot.success}`}
        />
        <h4 className="min-w-0 flex-1 truncate text-sm font-semibold">{words.title}</h4>
        <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
          {words.inDraft(inDraft, proposal.changes.length)}
        </span>
      </div>
      <div className="space-y-2 px-3 py-2.5">
        {proposal.summary && (
          <p className="text-sm text-gray-600 dark:text-gray-300">{proposal.summary}</p>
        )}
        {dirty && onAccept && open.length > 0 && (
          <p className={`text-xs ${toneInk.attention}`}>{words.saveFirst}</p>
        )}
        <ul className="space-y-2">
          {proposal.changes.map((change) => {
            const key = changeKey(change);
            const texts = changeTexts(change, base);
            const applied = changeIsApplied(change, base);
            const summary = summaries.get(key) ?? null;
            const reviewable =
              change.target === "description" && texts && !applied && !!onReviewScript;
            return (
              <li
                key={key}
                className="space-y-1.5 rounded-md border border-gray-200 px-2.5 py-2 dark:border-gray-800"
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {changeLabel(change)}
                  </span>
                  {applied ? (
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${toneSurface.success}`}
                    >
                      {words.accepted}
                    </span>
                  ) : (
                    onAccept &&
                    texts && (
                      <Button
                        size="sm"
                        variant="primary"
                        aria-label={`${words.accept}: ${changeLabel(change)}`}
                        disabled={dirty || accepting !== null}
                        onClick={() => {
                          setAccepting(key);
                          void onAccept(change).finally(() => setAccepting(null));
                        }}
                      >
                        {words.accept}
                      </Button>
                    )
                  )}
                </div>
                {!texts ? (
                  <p className={`text-xs ${toneInk.attention}`}>{words.nothingToApply}</p>
                ) : (
                  !applied &&
                  summary && (
                    <p className="flex flex-wrap items-center gap-x-1 text-xs text-gray-600 dark:text-gray-300">
                      <span>{summary.text}</span>
                      {summary.scenes.length > 0 && (
                        <>
                          <span>{words.inScenes}</span>
                          {summary.scenes.map((number, index) => (
                            <span key={number}>
                              {reviewable ? (
                                <button
                                  type="button"
                                  aria-label={S.activities.studioScript.scene(number)}
                                  onClick={() => onReviewScript?.(number)}
                                  className="text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-800 dark:text-brand-300 dark:decoration-brand-700"
                                >
                                  {number}
                                </button>
                              ) : (
                                number
                              )}
                              {index < summary.scenes.length - 1 ? "," : ""}
                            </span>
                          ))}
                        </>
                      )}
                    </p>
                  )
                )}
                {reviewable && review && (
                  <div className="flex items-center gap-2">
                    <div
                      role="progressbar"
                      aria-label={words.reviewProgress}
                      aria-valuemin={0}
                      aria-valuemax={review.total}
                      aria-valuenow={review.total - review.left}
                      className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
                    >
                      <div
                        className={`h-full rounded-full ${toneDot.success}`}
                        style={{
                          width: `${review.total ? ((review.total - review.left) / review.total) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <span
                      aria-live="polite"
                      className={`shrink-0 text-xs ${review.left ? "text-gray-500 dark:text-gray-400" : toneInk.success}`}
                    >
                      {review.left
                        ? words.reviewed(review.total - review.left, review.total)
                        : words.reviewDone}
                    </span>
                  </div>
                )}
                {texts && !applied && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {reviewable && (
                      <Button size="sm" variant="secondary" onClick={() => onReviewScript?.()}>
                        {words.reviewInScript}
                      </Button>
                    )}
                    <details className="min-w-0">
                      <summary className="cursor-pointer text-xs text-brand-700 hover:text-brand-800 dark:text-brand-300">
                        {words.showChange}
                      </summary>
                      <div className="mt-2">
                        <SpecDiffView compact saved={texts.before} edited={texts.after} />
                      </div>
                    </details>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      {footer && (
        <div className="flex items-center gap-2 rounded-b-xl border-t border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-800/60 dark:bg-gray-900">
          {onDiscard && (
            <Button
              size="sm"
              variant="ghostDanger"
              disabled={accepting !== null}
              onClick={() => setDiscarding(true)}
            >
              {words.discard}
            </Button>
          )}
          <span className="flex-1" />
          {onApplyAll && open.length > 0 && (
            <Button
              size="sm"
              variant="primary"
              disabled={dirty || accepting !== null}
              onClick={() => {
                setAccepting("*");
                void onApplyAll().finally(() => setAccepting(null));
              }}
            >
              {words.applyAll(open.length)}
            </Button>
          )}
        </div>
      )}
      {discarding && onDiscard && (
        <ConfirmModal
          open
          tone="primary"
          title={words.title}
          confirmLabel={words.discard}
          onClose={() => setDiscarding(false)}
          onConfirm={() => {
            setDiscarding(false);
            void onDiscard();
          }}
        >
          <p>{words.discardConfirm}</p>
        </ConfirmModal>
      )}
    </section>
  );
}
