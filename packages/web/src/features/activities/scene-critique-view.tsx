/**
 * A scene video's critique (experimental), in the Scene video section: an agent looks at stills
 * from the newest recording, scores it for young learners, and lists what to fix. Composing the
 * scene again hands the fixes to the composing agent.
 */
import { useEffect, useState } from "react";
import type { ActivityRunSummary, SceneCritique } from "@prismshadow/penguin-server/api";
import { apiFetch } from "../../api/client";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { InfoPopover } from "../../components/ui/info-popover";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { candidateUrl } from "./scene-timeline";
import { madeBy } from "./scene-video";

const words = S.activities.video.critique;
const RUBRIC = ["story", "layout", "readability", "motion", "learners"] as const;

/** The asset's critiques, newest first. */
export function critiqueRuns(
  runs: readonly ActivityRunSummary[],
  language: string,
  assetKey: string,
): ActivityRunSummary[] {
  return runs
    .filter(
      (run) =>
        run.kind === "critique" &&
        run.critique?.language === language &&
        run.critique.assetKey === assetKey,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Reads a critique run's kept output; null when it is not one. */
export function parseCritique(text: string | null): SceneCritique | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as SceneCritique;
    return value && typeof value.score === "number" && Array.isArray(value.fixes) ? value : null;
  } catch {
    return null;
  }
}

export function SceneCritiqueView({
  endpoint,
  critiques,
  newestRecording,
  canCritique,
  onCritique,
  onImprove,
}: {
  endpoint: string;
  critiques: readonly ActivityRunSummary[];
  /** The newest recording's run, which a critique is of. */
  newestRecording: string;
  /** Whether a critique may be asked for now (an agent is chosen, nothing else runs). */
  canCritique: boolean;
  onCritique?: () => void;
  /** Compose, record and critique round after round until it scores well. */
  onImprove?: () => void;
}) {
  const latest = critiques[0] ?? null;
  const running = latest?.status === "running";
  const [critique, setCritique] = useState<SceneCritique | null>(null);
  const shownRun = latest?.status === "succeeded" && latest.hasCandidate ? latest.runId : null;
  useEffect(() => {
    let live = true;
    setCritique(null);
    if (!shownRun) return;
    apiFetch<{ candidate: string | null }>(candidateUrl(endpoint, shownRun))
      .then(({ candidate }) => {
        if (live) setCritique(parseCritique(candidate));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [endpoint, shownRun]);
  const good = critique ? critique.score >= 4 : false;
  return (
    <section className="space-y-2" aria-label={words.title}>
      <h5 className="flex items-center gap-2 text-xs font-semibold">
        {words.title}
        <InfoPopover label={words.title}>{words.info}</InfoPopover>
        {critique && (
          <Badge tone={good ? "green" : "amber"}>{words.score(String(critique.score))}</Badge>
        )}
      </h5>
      {critique && latest && madeBy(latest) && (
        <p className="text-xs text-gray-500">{S.activities.video.madeBy(madeBy(latest)!)}</p>
      )}
      {critique && (
        <>
          {critique.recordingRunId !== newestRecording && (
            <p className="text-xs text-gray-500">{words.older}</p>
          )}
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {RUBRIC.map((key) => (
              <li key={key}>
                {words.rubric[key]}: <span className="font-medium">{critique.scores[key]}</span>
              </li>
            ))}
          </ul>
          {critique.fixes.length ? (
            <div className="space-y-1">
              <p className="text-xs font-medium">{words.fixes}</p>
              <ol className={`list-decimal space-y-0.5 pl-4 text-xs ${toneInk.attention}`}>
                {critique.fixes.map((fix, index) => (
                  <li key={index}>{fix}</li>
                ))}
              </ol>
              <p className="text-xs text-gray-500">{words.composeAgain}</p>
            </div>
          ) : (
            <p className="text-xs text-gray-500">{words.noFixes}</p>
          )}
        </>
      )}
      {latest?.status === "failed" && (
        <p className={`break-words text-xs ${toneInk.danger}`}>
          {words.failed(latest.error ?? S.activities.video.noCause)}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {onCritique && (
          <Button size="sm" disabled={!canCritique || running} onClick={onCritique}>
            {running ? words.critiquing : words.critique}
          </Button>
        )}
        {onImprove && (
          <>
            <Button size="sm" disabled={!canCritique || running || good} onClick={onImprove}>
              {words.improve}
            </Button>
            <InfoPopover label={words.improve}>{words.improveInfo}</InfoPopover>
          </>
        )}
      </div>
    </section>
  );
}
