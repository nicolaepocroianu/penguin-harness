/**
 * The activity's History: its saved versions, its module builds, then every run, newest first, with
 * how it went, its Session (its transcript shown in place, or opened as its own page), a way to
 * cancel one still running, and the candidate a specification run left.
 *
 * A run the header's running chip follows, when no tool follows it, opens here with its
 * transcript shown and scrolled into view.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type {
  ActivityDraft,
  ActivityRun,
  ActivityRunSummary,
} from "@prismshadow/penguin-server/api";
import { Button, Pill } from "@prismshadow/penguin-ui";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk, toneName, type Tone } from "../../lib/tone";
import { runKindLabel, type Announcement } from "./run-toasts";
import { ModuleBuildsView } from "./module-builds-view";
import { RunTranscript } from "./run-transcript";
import { VersionsView } from "./versions-view";
import { useActivityClient } from "./activity-client";

const runTone: Record<ActivityRun["status"], Tone> = {
  running: "busy",
  succeeded: "success",
  failed: "danger",
  conflict: "attention",
  cancelled: "muted",
  interrupted: "attention",
};

export function GenerationHistory({
  runs,
  draftRevision,
  editable,
  busy,
  onCancel,
  onUseCandidate,
  onAnnounce,
  unsaved = false,
  onRestored,
  onDraft,
  pinnedModuleRunId,
  focusRun = null,
}: {
  runs: readonly ActivityRunSummary[];
  /** The draft's revision, which says when a module was built from an older one. */
  draftRevision: string;
  editable: boolean;
  busy: boolean;
  onCancel: (runId: string) => void;
  /** Put a specification run's candidate in the editor. */
  onUseCandidate: (candidate: string) => void;
  /** Say that a version was saved or restored. */
  onAnnounce: (announcement: Announcement) => void;
  /** Whether the editor holds edits not saved yet, which a restore replaces. */
  unsaved?: boolean;
  /** The draft a restored version made. */
  onRestored?: (draft: ActivityDraft) => void;
  /** The draft pinning or unpinning a module build made; only the draft changed. */
  onDraft?: (draft: ActivityDraft) => void;
  /** The build the draft pins, which keeps Module builds shown so it can be unpinned. */
  pinnedModuleRunId?: string;
  /**
   * A run to show with its transcript open, as when the header's running chip follows it here;
   * `at` tells a second request for the same run from the first.
   */
  focusRun?: { runId: string; at: number } | null;
}) {
  const words = S.activities.runTranscript;
  // The run whose transcript is shown in place; one at a time.
  const [open, setOpen] = useState<string | null>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    if (!focusRun) return;
    setOpen(focusRun.runId);
    cards.current.get(focusRun.runId)?.scrollIntoView({ block: "nearest" });
  }, [focusRun]);
  const builds = runs
    .filter((run) => run.kind === "module" && run.status === "succeeded")
    .map((run) => run.runId)
    .join(",");
  return (
    <div className="space-y-6">
      <h3 className="text-sm font-semibold">{S.activities.sectionNames.history}</h3>
      <VersionsView
        editable={editable}
        draftRevision={draftRevision}
        unsaved={unsaved}
        onAnnounce={onAnnounce}
        onRestored={onRestored}
      />
      {(builds || pinnedModuleRunId) && (
        <ModuleBuildsView
          editable={editable}
          draftRevision={draftRevision}
          buildsKey={builds}
          onAnnounce={onAnnounce}
          onDraft={(draft) => onDraft?.(draft)}
        />
      )}
      <section className="space-y-1">
        <h4 className="text-sm font-semibold">{S.activities.runs}</h4>
        {runs.length === 0 && <p className="text-xs text-gray-500">{S.activities.noRuns}</p>}
        {/* Rows on rules rather than a card each: the runs are one list, read top to bottom. */}
        <div className="divide-y divide-gray-200 dark:divide-gray-800">
          {runs.map((run) => {
            const expanded = open === run.runId && !!run.sessionId;
            const time = new Date(run.createdAt).toLocaleString();
            const transcriptId = `run-transcript-${run.runId}`;
            return (
              <article
                key={run.runId}
                ref={(element) => {
                  if (element) cards.current.set(run.runId, element);
                  else cards.current.delete(run.runId);
                }}
                className="space-y-2 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium">{runKindLabel(run)}</span>
                  <Pill tone={toneName[runTone[run.status]]}>
                    {run.kind === "module" && run.status === "succeeded"
                      ? S.activities.moduleReady
                      : run.kind === "audio" || run.kind === "image" || run.kind === "media-text"
                        ? S.activities.speechStatus[run.status]
                        : S.activities.status[run.status]}
                  </Pill>
                  <time className="ml-auto text-xs text-gray-500" dateTime={run.createdAt}>
                    {time}
                  </time>
                </div>
                {run.error && <p className="break-words text-xs">{run.error}</p>}
                {run.status === "running" && (
                  <p className="text-xs text-gray-500">{S.activities.runningHelp}</p>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  {run.kind === "module" && run.status === "succeeded" && run.sessionId && (
                    <a
                      className="text-xs underline"
                      target="_blank"
                      rel="noopener noreferrer"
                      href={`/api/sessions/${encodeURIComponent(run.sessionId)}/files/preview-redirect?path=preview%2Findex.html`}
                    >
                      {S.activities.previewModule}
                    </a>
                  )}
                  {run.sessionId && (
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={transcriptId}
                      aria-label={words.toggle(
                        expanded ? words.hide : words.show,
                        runKindLabel(run),
                        time,
                      )}
                      onClick={() =>
                        setOpen((current) => (current === run.runId ? null : run.runId))
                      }
                      className="text-xs text-brand-600 hover:text-brand-700 dark:text-brand-300"
                    >
                      {expanded ? words.hide : words.show}
                    </button>
                  )}
                  {run.sessionId && (
                    <Link
                      className="text-xs underline"
                      to={`/chat/${encodeURIComponent(run.sessionId)}`}
                    >
                      {S.activities.openSession}
                    </Link>
                  )}
                  {editable && run.status === "running" && (
                    <Button size="sm" disabled={busy} onClick={() => onCancel(run.runId)}>
                      {S.activities.cancel}
                    </Button>
                  )}
                </div>
                {expanded && (
                  <div
                    id={transcriptId}
                    className="overflow-hidden rounded-control border border-gray-200 dark:border-gray-800"
                  >
                    <RunTranscript sessionId={run.sessionId!} running={run.status === "running"} />
                  </div>
                )}
                {run.hasCandidate && (
                  <CandidateReview
                    runId={run.runId}
                    editable={editable && run.kind === "spec"}
                    busy={busy}
                    onUse={onUseCandidate}
                  />
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function CandidateReview({
  runId,
  editable,
  busy,
  onUse,
}: {
  runId: string;
  editable: boolean;
  busy: boolean;
  onUse: (candidate: string) => void;
}) {
  const { api } = useActivityClient();
  const [candidate, setCandidate] = useState<string | null>(null);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function load() {
    if (pending.current || candidate !== null) return;
    pending.current = true;
    setError("");
    try {
      const result = await api.runs.candidate(runId);
      if (alive.current) setCandidate(result.candidate ?? "");
    } catch (e) {
      if (alive.current) setError(apiErrorText(e));
    } finally {
      pending.current = false;
    }
  }
  return (
    <details
      className="text-xs"
      onToggle={(event) => {
        if (event.currentTarget.open) void load();
      }}
    >
      <summary className="cursor-pointer">{S.activities.candidate}</summary>
      {error ? (
        <div className="my-2 space-y-2">
          <p role="alert" className={toneInk.danger}>
            {error}
          </p>
          <Button size="sm" onClick={() => void load()}>
            {S.common.retry}
          </Button>
        </div>
      ) : (
        <pre className="my-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-gray-50 p-2 dark:bg-gray-900">
          {candidate ?? S.activities.loading}
        </pre>
      )}
      {editable && (
        <Button size="sm" disabled={busy || candidate === null} onClick={() => onUse(candidate!)}>
          {S.activities.useCandidate}
        </Button>
      )}
    </details>
  );
}
