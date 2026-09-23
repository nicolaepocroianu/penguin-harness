/**
 * The agent's current proposal, one change per row: what it changes, the diff against the
 * saved draft, and Accept. Accepting goes through the same route an author's own save does,
 * with the same revision check, so an accepted proposal is an ordinary draft change.
 */
import { useState } from "react";
import { Button } from "../../components/ui/button";
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
import { SpecDiffView } from "./spec-diff-view";

export function ProposalCard({
  proposal,
  base,
  dirty,
  onAccept,
}: {
  proposal: AssistProposal;
  base: ProposalBase;
  /** The author has unsaved edits, which accepting would overwrite. */
  dirty: boolean;
  onAccept?: (change: ProposalChange) => Promise<void>;
}) {
  const words = S.activities.studioProposal;
  const [accepting, setAccepting] = useState<string | null>(null);
  return (
    <section aria-label={words.title} className="space-y-2">
      <h4 className="text-sm font-semibold">{words.title}</h4>
      {proposal.summary && (
        <p className="text-sm text-gray-600 dark:text-gray-300">{proposal.summary}</p>
      )}
      {dirty && onAccept && <p className={`text-xs ${toneInk.attention}`}>{words.saveFirst}</p>}
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
