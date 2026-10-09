/**
 * The module release and the QA deploy, in the Deploy section: each stage with its state and
 * why it cannot run now, Deploy to QA and Release module (each behind a confirmation, since
 * they push branches and start Jenkins jobs), one stage at a time under "Run one stage", Stop,
 * and the log, followed every second while a run goes. Deploy to QA waits while the readiness
 * checks list problems, and says so beside it.
 */
import { useEffect, useRef, useState } from "react";
import type {
  DeployLogLine,
  DeployLogResponse,
  DeployRun,
  DeployRunResponse,
  DeployStage,
  DeployStageSelection,
  DeployStageState,
} from "@prismshadow/penguin-server/api";
import { ApiError, apiFetch } from "../../api/client";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { InfoPopover } from "../../components/ui/info-popover";
import { Input } from "../../components/ui/input";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { DeployTimeline } from "./deploy-timeline";
import {
  appendLog,
  isProdRun,
  deployPhases,
  markBlocked,
  preflightFindings,
  refusalText,
  runLine,
  stageConfirmText,
  stageName,
  stageRows,
  versionProblem,
} from "./deploy-model";
import type { Announcement } from "./run-toasts";

/** What this section starts: the release, the QA deploy or one of their stages. PROD is the PROD bar's. */
type QaSelection = Exclude<DeployStageSelection, "prod">;

/** How often the log is asked for while a release runs. */
const POLL_MS = 1000;

export function DeployRelease({
  endpoint,
  editable,
  run,
  stages,
  branch,
  activityDataBranch,
  productCode,
  readinessBlocker,
  onRun,
  onSettled,
  onAnnounce,
}: {
  endpoint: string;
  editable: boolean;
  run: DeployRun | null;
  stages: readonly DeployStageState[];
  /** The module's deploy branch, which the confirmation names. */
  branch: string;
  /** The activity-data branch a QA deploy pushes, which its confirmation names. */
  activityDataBranch: string;
  productCode: string;
  /** Why Deploy to QA waits on the readiness checks; null when they pass. */
  readinessBlocker: string | null;
  /** A run started, or the log poll brought a newer state of it. */
  onRun: (run: DeployRun) => void;
  /** A followed run ended: the stage states and readiness are read again. */
  onSettled: () => void;
  onAnnounce: (announcement: Announcement) => void;
}) {
  const words = S.activities.deploy;
  const [confirm, setConfirm] = useState<QaSelection | null>(null);
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState<"start" | "stop" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [lines, setLines] = useState<DeployLogLine[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const logRef = useRef<HTMLPreElement | null>(null);
  const follow = useRef(true);
  const callbacks = useRef({ onRun, onSettled, onAnnounce });
  callbacks.current = { onRun, onSettled, onAnnounce };
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const runId = run?.runId ?? null;
  const running = run?.status === "running";
  // Follows the run's log from the start: every second while it runs, at once while pages are
  // full; when it ends, the stages are read again and the end is announced.
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cursor = 0;
    let sawRunning = false;
    setLines([]);
    follow.current = true;
    const tick = async () => {
      try {
        const res = await apiFetch<DeployLogResponse>(
          `${endpoint}/deploy/runs/${runId}/log?after=${cursor}`,
        );
        if (cancelled) return;
        cursor = res.log.next;
        setLines((previous) => appendLog(previous, res.log));
        callbacks.current.onRun(res.run);
        if (res.run.status === "running") sawRunning = true;
        if (res.log.done) {
          if (sawRunning) {
            const line = runLine(res.run);
            if (line)
              callbacks.current.onAnnounce({
                kind:
                  res.run.status === "succeeded"
                    ? "success"
                    : res.run.status === "failed"
                      ? "error"
                      : "attention",
                text: line.text,
              });
            callbacks.current.onSettled();
          }
          return;
        }
        timer = setTimeout(() => void tick(), res.log.lines.length >= 500 ? 0 : POLL_MS);
      } catch {
        if (!cancelled) timer = setTimeout(() => void tick(), POLL_MS * 2);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [endpoint, runId]);

  // The log opens by itself once a run goes or has written something, and again for each new
  // run; within a run the reader may fold it.
  const logging = running || lines.length > 0;
  useEffect(() => {
    if (logging) setLogOpen(true);
  }, [logging, runId]);

  // Keeps the newest line in view unless the reader scrolled up to read an older one.
  useEffect(() => {
    const element = logRef.current;
    if (element && follow.current) element.scrollTop = element.scrollHeight;
  }, [lines]);

  async function start(selection: QaSelection) {
    const problem = selection === "release" ? versionProblem(version) : null;
    if (problem) return;
    setBusy("start");
    setError(null);
    try {
      const value = await apiFetch<DeployRunResponse>(`${endpoint}/deploy`, {
        method: "POST",
        body: {
          stage: selection,
          ...(selection === "release" && version.trim() ? { moduleVersion: version.trim() } : {}),
        },
      });
      if (!alive.current) return;
      setConfirm(null);
      onRun(value.run);
      onAnnounce({
        kind: "info",
        text:
          selection === "release"
            ? words.releaseStarted
            : selection === "qa"
              ? words.deployQaStarted
              : words.stageStarted(stageName(selection)),
      });
    } catch (cause) {
      if (alive.current) {
        setConfirm(null);
        // The stages shown were out of date (another tab or owner moved them): say why in the
        // stage list's words, and read the stages again.
        const blocked =
          cause instanceof ApiError &&
          (cause.code === "deploy_blocked" || cause.code === "deploy_running");
        setError((blocked && refusalText((cause as ApiError).detail)) || apiErrorText(cause));
        if (blocked) onSettled();
      }
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  async function stop() {
    setBusy("stop");
    setError(null);
    try {
      const value = await apiFetch<DeployRunResponse>(`${endpoint}/deploy/stop`, {
        method: "POST",
      });
      if (alive.current) onRun(value.run);
    } catch (cause) {
      if (alive.current) setError(apiErrorText(cause));
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  const branches = { deploy: branch, activityData: activityDataBranch };

  /** A stage that pushes or starts a Jenkins job asks first; the others only work here or wait. */
  function runStage(stage: DeployStage) {
    if (stageConfirmText(stage, branches) !== null) setConfirm(stage);
    else void start(stage);
  }

  const rows = markBlocked(stageRows(run, stages));
  const phases = deployPhases(rows);
  const done = rows.filter((row) => row.status === "done").length;
  // A PROD run's line is the PROD card's.
  const line = run && isProdRun(run) ? null : runLine(run);
  const first = rows[0];
  const canRelease = editable && !running && busy === null && first !== undefined && !first.blocker;
  const canDeployQa = canRelease && readinessBlocker === null;
  const startBlocker = running ? null : (readinessBlocker ?? first?.blocker ?? null);
  const versionError = versionProblem(version);
  const buildUrl = run?.metadata.moduleBuildUrl;
  const resolved = run?.metadata.resolvedModuleVersion;
  const findings = preflightFindings(run, stages);
  const confirmText =
    confirm === null || confirm === "release" || confirm === "qa"
      ? null
      : stageConfirmText(confirm, branches);
  const hasLog = lines.length > 0;
  return (
    <section
      className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800"
      aria-labelledby="activity-deploy-release-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 p-4">
        <div className="min-w-0">
          <h4
            id="activity-deploy-release-title"
            className="flex items-center gap-2 text-base font-semibold"
          >
            {words.workflowTitle}
            <InfoPopover label={words.workflowTitle}>
              <p>{words.releaseAbout}</p>
              <p className="mt-2">{words.qaAbout}</p>
            </InfoPopover>
          </h4>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {words.workflowSummary} {words.stageProgress(done, rows.length)}.
          </p>
        </div>
        {editable && (
          <div className="flex flex-wrap gap-2">
            {running && (
              <Button
                size="sm"
                disabled={busy !== null}
                aria-busy={busy === "stop"}
                onClick={() => void stop()}
              >
                {busy === "stop" ? words.stopping : words.stop}
              </Button>
            )}
            <Button size="sm" aria-pressed={advanced} onClick={() => setAdvanced(!advanced)}>
              {words.advanced}
            </Button>
            <Button
              size="sm"
              disabled={!canRelease}
              aria-busy={busy === "start" && confirm === "release"}
              onClick={() => setConfirm("release")}
            >
              {running && run?.selection === "release" ? words.releasing : words.releaseModule}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!canDeployQa}
              aria-describedby={!canDeployQa && startBlocker ? "deploy-start-blocker" : undefined}
              aria-busy={busy === "start" && confirm === "qa"}
              onClick={() => setConfirm("qa")}
            >
              {running && run?.selection === "qa" ? words.deployingQa : words.deployQa}
            </Button>
          </div>
        )}
      </div>
      {startBlocker && (
        <p
          id="deploy-start-blocker"
          className="border-t border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-300"
        >
          {startBlocker}
        </p>
      )}
      {(line || error || run?.skipped?.length || resolved || buildUrl) && (
        <div className="space-y-2 border-t border-gray-200 px-4 py-3 dark:border-gray-800">
          {line && (
            <p
              role="status"
              className={`text-sm font-medium ${toneInk[line.tone]}`}
              data-testid="deploy-run-status"
            >
              {line.text}
            </p>
          )}
          {error && (
            <p role="alert" className={`text-xs ${toneInk.danger}`}>
              {error}
            </p>
          )}
          {run?.skipped?.length ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">{words.releaseSkipped}</p>
          ) : null}
          {(resolved || buildUrl) && (
            <p className="flex flex-wrap gap-x-3 text-sm">
              {resolved && <span>{words.resolvedVersion(resolved)}</span>}
              {buildUrl && (
                <a
                  href={buildUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  {words.openBuild}
                </a>
              )}
            </p>
          )}
        </div>
      )}
      <div className="border-t border-gray-200 dark:border-gray-800">
        <DeployTimeline
          phases={phases}
          advanced={advanced && editable}
          disabled={running || busy !== null}
          onRun={runStage}
        />
      </div>
      {findings && (
        <section
          aria-labelledby="activity-deploy-preflight-title"
          className="space-y-1 border-t border-gray-200 px-4 py-3 dark:border-gray-800"
        >
          <h5 id="activity-deploy-preflight-title" className="text-xs font-semibold">
            {words.preflightTitle}
          </h5>
          {findings.errors.length > 0 && (
            <>
              <h6 id="activity-deploy-preflight-errors" className={`text-xs ${toneInk.danger}`}>
                {words.preflightErrors}
              </h6>
              <ul
                aria-labelledby="activity-deploy-preflight-errors"
                className="list-disc space-y-1 pl-5 text-xs"
              >
                {findings.errors.map((text, index) => (
                  <li key={index} className={toneInk.danger}>
                    {text}
                  </li>
                ))}
              </ul>
            </>
          )}
          {findings.warnings.length > 0 && (
            <>
              <h6
                id="activity-deploy-preflight-warnings"
                className="text-xs text-gray-600 dark:text-gray-300"
              >
                {words.preflightWarnings}
              </h6>
              <ul
                aria-labelledby="activity-deploy-preflight-warnings"
                className="list-disc space-y-1 pl-5 text-xs"
              >
                {findings.warnings.map((text, index) => (
                  <li key={index} className="text-gray-600 dark:text-gray-300">
                    {text}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      <details
        open={logOpen}
        onToggle={(event) => setLogOpen(event.currentTarget.open)}
        className="border-t border-gray-200 dark:border-gray-800"
      >
        <summary className="flex cursor-pointer items-baseline gap-2 px-4 py-2.5 focus-visible:outline-2 focus-visible:outline-offset-2">
          <span id="activity-deploy-log-title" className="text-xs font-semibold">
            {words.log}
          </span>
          {!hasLog && (
            <span className="text-xs text-gray-500 dark:text-gray-400">{words.logEmpty}</span>
          )}
        </summary>
        <pre
          ref={logRef}
          data-testid="deploy-log"
          onScroll={(event) => {
            const element = event.currentTarget;
            follow.current = element.scrollTop + element.clientHeight >= element.scrollHeight - 8;
          }}
          tabIndex={0}
          aria-labelledby="activity-deploy-log-title"
          className="max-h-[32rem] min-h-24 overflow-auto whitespace-pre-wrap break-words border-t border-gray-200 bg-gray-50/50 p-4 font-mono text-xs leading-relaxed dark:border-gray-800 dark:bg-gray-900/40"
        >
          {hasLog ? lines.map((entry) => entry.text).join("\n") : words.logEmpty}
        </pre>
      </details>
      <ConfirmModal
        open={confirm !== null}
        title={
          confirm === "qa"
            ? words.deployQaConfirmTitle
            : confirm === "release" || confirm === null
              ? words.releaseConfirmTitle
              : words.stageConfirmTitle(stageName(confirm))
        }
        tone="primary"
        confirmLabel={
          confirm === "release"
            ? words.releaseConfirmLabel
            : confirm === "qa"
              ? words.deployQaConfirmLabel
              : words.run
        }
        confirmDisabled={confirm === "release" && versionError !== null}
        busy={busy === "start"}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && void start(confirm)}
      >
        <div className="space-y-3">
          {confirm === "qa" ? (
            <div className="space-y-1 text-sm text-gray-600 dark:text-gray-300">
              <p>{words.deployQaConfirm(productCode)}</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>{words.deployQaConfirmItems.release(branch)}</li>
                <li>{words.deployQaConfirmItems.media}</li>
                <li>{words.deployQaConfirmItems.data(activityDataBranch)}</li>
                <li>{words.deployQaConfirmItems.deploy}</li>
              </ul>
            </div>
          ) : (
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {confirm === "release" ? words.releaseConfirm(branch) : confirmText}
            </p>
          )}
          {confirm === "release" && (
            <Input
              size="sm"
              label={words.moduleVersion}
              hint={words.moduleVersionHint}
              error={versionError ?? undefined}
              value={version}
              inputMode="decimal"
              onChange={(event) => setVersion(event.target.value)}
            />
          )}
        </div>
      </ConfirmModal>
    </section>
  );
}
