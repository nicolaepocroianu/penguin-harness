/**
 * The QA lane, beside the PROD one: where the activity stands on QA, one Deploy to QA (behind a
 * confirmation, since it pushes branches and starts Jenkins jobs) and the stages it runs in
 * their three phases. Releasing the module on its own, and running one stage at a time, sit in
 * the lane's More menu. Deploy to QA waits while readiness problems block it, and says so beside
 * it; the problems themselves are said once, above the lanes, next to their fixes. Once the module
 * build or the QA deploy was started and the wait for it did not finish, waiting for it comes
 * first, beside Deploy to QA: the build may still be going in Jenkins, or already done.
 */
import { useEffect, useRef, useState } from "react";
import type {
  DeployProblem,
  DeployRun,
  DeployStage,
  DeployStageSelection,
  DeployStageState,
} from "@prismshadow/penguin-server/api";
import { ApiError } from "../../api/client";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { Dropdown, menuItemClass } from "../../components/ui/dropdown";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { CheckIcon } from "../../components/ui/icons";
import { ELLIPSIS_ICON } from "../../components/ui/session-row-menu";
import { InfoPopover } from "../../components/ui/info-popover";
import { Input } from "../../components/ui/input";
import { apiErrorText } from "../../lib/api-error";
import { ICON_SIZE } from "../../lib/icon-scale";
import { S } from "../../lib/strings";
import { toneInk, toneText } from "../../lib/tone";
import { DeployStatePill } from "./deploy-state-pill";
import { DeployTimeline } from "./deploy-timeline";
import {
  deployPhases,
  isProdRun,
  markBlocked,
  pointToReadiness,
  preflightFindings,
  qaResult,
  qaStatus,
  qaWait,
  refusalText,
  runLine,
  stageConfirmText,
  stageName,
  stageRows,
  versionProblem,
} from "./deploy-model";
import type { Announcement } from "./run-toasts";
import { useActivityClient } from "./activity-client";

/** What this lane starts: the release, the QA deploy or one of their stages. PROD is the PROD lane's. */
type QaSelection = Exclude<DeployStageSelection, "prod">;

export function DeployQa({
  editable,
  run,
  stages,
  problems,
  branch,
  activityDataBranch,
  productCode,
  readinessBlocker,
  onRun,
  onSettled,
  onAnnounce,
}: {
  editable: boolean;
  run: DeployRun | null;
  stages: readonly DeployStageState[];
  /** What the readiness strip above lists, which a stage points to rather than repeats. */
  problems: readonly DeployProblem[];
  /** The module's deploy branch, which the confirmation names. */
  branch: string;
  /** The activity-data branch a QA deploy pushes, which its confirmation names. */
  activityDataBranch: string;
  productCode: string;
  /** Why Deploy to QA waits on the readiness checks; null when they pass. */
  readinessBlocker: string | null;
  /** A run started. */
  onRun: (run: DeployRun) => void;
  /** A start was refused because the stages shown were out of date: read them again. */
  onSettled: () => void;
  onAnnounce: (announcement: Announcement) => void;
}) {
  const { api } = useActivityClient();
  const words = S.activities.deploy;
  const [confirm, setConfirm] = useState<QaSelection | null>(null);
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState<"start" | "stop" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const running = run?.status === "running";

  async function start(selection: QaSelection, announce?: string) {
    const problem = selection === "release" ? versionProblem(version) : null;
    if (problem) return;
    setBusy("start");
    setError(null);
    try {
      const value = await api.deploy.start({
        stage: selection,
        ...(selection === "release" && version.trim() ? { moduleVersion: version.trim() } : {}),
      });
      if (!alive.current) return;
      setConfirm(null);
      onRun(value.run);
      onAnnounce({
        kind: "info",
        text:
          announce ??
          (selection === "release"
            ? words.releaseStarted
            : selection === "qa"
              ? words.deployQaStarted
              : words.stageStarted(stageName(selection))),
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
      const value = await api.deploy.stop();
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

  const rows = pointToReadiness(markBlocked(stageRows(run, stages)), stages, problems);
  const phases = deployPhases(rows);
  const done = rows.filter((row) => row.status === "done").length;
  // A PROD run's line is the PROD lane's.
  const line = run && isProdRun(run) ? null : runLine(run);
  const first = rows[0];
  const canRelease = editable && !running && busy === null && first !== undefined && !first.blocker;
  const canDeployQa = canRelease && readinessBlocker === null;
  const startBlocker = running ? null : (readinessBlocker ?? first?.blocker ?? null);
  const versionError = versionProblem(version);
  const buildUrl = run?.metadata.moduleBuildUrl;
  const resolved = run?.metadata.resolvedModuleVersion;
  const findings = preflightFindings(run, stages);
  const status = qaStatus(run, stages);
  const onQa = qaResult(stages);
  const wait = qaWait(stages, run);
  const confirmText =
    confirm === null || confirm === "release" || confirm === "qa"
      ? null
      : stageConfirmText(confirm, branches);
  return (
    <section
      className="min-w-0 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800"
      aria-labelledby="activity-deploy-qa-title"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
        <h4 id="activity-deploy-qa-title" className="flex items-center gap-2 text-sm font-semibold">
          {words.qaTitle}
          <InfoPopover label={words.workflowTitle}>
            <p>{words.releaseAbout}</p>
            <p className="mt-2">{words.qaAbout}</p>
          </InfoPopover>
        </h4>
        <DeployStatePill tone={status.tone} text={status.text} testId="deploy-qa-state" />
        <span className="flex-1" />
        {editable && (
          <div className="flex flex-wrap items-center gap-1.5">
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
            <Dropdown
              open={menuOpen}
              setOpen={setMenuOpen}
              portal={{ direction: "down", align: "right" }}
              menuClass="w-60 max-w-[calc(100vw-1.5rem)]"
              button={
                <Button
                  size="sm"
                  variant="ghost"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label={words.moreActions}
                  title={words.moreActions}
                  onClick={() => setMenuOpen(!menuOpen)}
                >
                  <GlyphIcon d={ELLIPSIS_ICON} size={ICON_SIZE.iconButton} filled />
                </Button>
              }
            >
              <div role="menu" aria-label={words.moreActions} className="py-1">
                <button
                  type="button"
                  role="menuitem"
                  disabled={!canRelease}
                  aria-busy={busy === "start" && confirm === "release"}
                  onClick={() => {
                    setMenuOpen(false);
                    setConfirm("release");
                  }}
                  className={`${menuItemClass} disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {running && run?.selection === "release" ? words.releasing : words.releaseOnly}
                </button>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={advanced}
                  onClick={() => {
                    setMenuOpen(false);
                    setAdvanced(!advanced);
                  }}
                  className={`${menuItemClass} flex items-center justify-between gap-2`}
                >
                  {words.advanced}
                  {advanced && <CheckIcon />}
                </button>
              </div>
            </Dropdown>
            <Button
              size="sm"
              variant={wait ? "secondary" : "primary"}
              disabled={!canDeployQa}
              aria-describedby={!canDeployQa && startBlocker ? "deploy-start-blocker" : undefined}
              aria-busy={busy === "start" && confirm === "qa"}
              onClick={() => setConfirm("qa")}
            >
              {running && run?.selection === "qa" ? words.deployingQa : words.deployQa}
            </Button>
            {wait && (
              <Button
                size="sm"
                variant="primary"
                disabled={busy !== null || wait.blocker !== null}
                aria-describedby="deploy-qa-wait"
                aria-busy={busy === "start" && confirm === null}
                onClick={() => void start(wait.stage, words.waitStarted[wait.stage])}
              >
                {stageName(wait.stage)}
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="space-y-4 px-4 py-3">
        {wait && (
          <p
            id="deploy-qa-wait"
            className={`text-xs ${wait.blocker ? "text-gray-600 dark:text-gray-300" : toneInk.attention}`}
            data-testid="deploy-qa-wait"
          >
            {wait.blocker ?? words.waitFirst[wait.stage]}
          </p>
        )}
        {startBlocker && (
          <p id="deploy-start-blocker" className="text-xs text-gray-600 dark:text-gray-300">
            {startBlocker}
          </p>
        )}
        {onQa ? (
          <p className="flex flex-wrap items-center gap-x-3 text-sm" data-testid="deploy-qa-result">
            <a
              href={onQa.url}
              target="_blank"
              rel="noreferrer"
              className="font-medium underline underline-offset-2"
            >
              {words.openQa}
            </a>
            {onQa.version && <span>{words.qaVersion(onQa.version)}</span>}
          </p>
        ) : (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {words.qaExplain} {words.stageProgress(done, rows.length)}.
          </p>
        )}
        {(line || error || run?.skipped?.length || resolved || buildUrl) && (
          <div className="space-y-2">
            {line && (
              <p
                role="status"
                className={`text-sm font-medium ${toneText[line.tone]}`}
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
        <DeployTimeline
          phases={phases}
          advanced={advanced && editable}
          disabled={running || busy !== null}
          said={startBlocker}
          onRun={runStage}
        />
        {findings && (
          <section aria-labelledby="activity-deploy-preflight-title" className="space-y-1">
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
      </div>
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
