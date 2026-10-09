/**
 * The agent's current proposal, one change per row: what it changes, the diff against the
 * saved draft, and Accept. Accepting goes through the same route an author's own save does,
 * with the same revision check, so an accepted proposal is an ordinary draft change.
 */
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import {
  changeIsApplied,
  changeKey,
  changeLabel,
  changeTexts,
  type AssistProposal,
  type ProposalBase,
  type ProposalChange,
} from "./proposal";
import type { ScriptReview } from "./script-editor";
import { sceneRanges, scenesTouched } from "./script-model";
import { diffLines } from "./spec-diff";
import { SpecDiffView } from "./spec-diff-view";

/** The script's scenes a proposed script changes, in order. */
function changedScenes(before: string, after: string): number[] {
  return scenesTouched(diffLines(before, after), sceneRanges(after));
}

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
  return (
    <section aria-label={words.title} className="space-y-2">
      <h4 className="text-sm font-semibold">{words.title}</h4>
      {proposal.summary && (
        <p className="text-sm text-gray-600 dark:text-gray-300">{proposal.summary}</p>
      )}
      {dirty && onAccept && <p className={`text-xs ${toneInk.attention}`}>{words.saveFirst}</p>}
      {(onApplyAll || onDiscard) && (
        <div className="flex flex-wrap items-center gap-2">
          {onApplyAll && open.length > 1 && (
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
          {onDiscard && (
            <Button
              size="sm"
              variant="ghost"
              disabled={accepting !== null}
              onClick={() => setDiscarding(true)}
            >
              {words.discard}
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
      <ul className="space-y-2">
        {proposal.changes.map((change) => {
          const key = changeKey(change);
          const texts = changeTexts(change, base);
          const applied = changeIsApplied(change, base);
          return (
            <li key={key} className="rounded-md border border-gray-200 p-2 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">{changeLabel(change)}</span>
                {applied ? (
                  <span className="text-xs text-gray-500">{words.accepted}</span>
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
              {change.target === "description" && texts && !applied && onReviewScript && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                  <Button size="sm" variant="secondary" onClick={() => onReviewScript()}>
                    {words.reviewInScript}
                  </Button>
                  {changedScenes(texts.before, texts.after).map((number) => (
                    <button
                      key={number}
                      type="button"
                      onClick={() => onReviewScript(number)}
                      className="rounded px-1.5 py-0.5 text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-950"
                    >
                      {S.activities.studioScript.scene(number)}
                    </button>
                  ))}
                  {review && (
                    <span
                      aria-live="polite"
                      className={review.left ? toneInk.attention : toneInk.success}
                    >
                      {review.left ? words.reviewLeft(review.left, review.total) : words.reviewDone}
                    </span>
                  )}
                </div>
              )}
              {!texts ? (
                <p className={`mt-1 text-xs ${toneInk.attention}`}>{words.nothingToApply}</p>
              ) : (
                !applied && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-gray-500">
                      {words.showChange}
                    </summary>
                    <div className="mt-2">
                      <SpecDiffView compact saved={texts.before} edited={texts.after} />
                    </div>
                  </details>
                )
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
