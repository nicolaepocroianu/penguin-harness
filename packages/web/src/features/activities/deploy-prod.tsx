/**
 * The PROD lane, beside the QA one: where PROD stands (a short state, the last deploy, why it
 * cannot start now, its two stages), and Deploy to PROD for an admin who owns the project. The
 * button opens a dialog whose confirm stays disabled until the product code is typed; the server
 * checks the code, the admin and that QA has the activity as it is now again. Once a PROD deploy
 * was started and the wait for it did not finish, Wait for the PROD deploy comes first, so a retry
 * follows that deploy rather than starting a second. The run's log is the one under both lanes.
 */
import { useEffect, useRef, useState } from "react";
import type {
  DeployProblem,
  DeployProductionState,
  DeployRun,
} from "@prismshadow/penguin-server/api";
import { ApiError } from "../../api/client";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { InfoPopover } from "../../components/ui/info-popover";
import { Input } from "../../components/ui/input";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime } from "../../lib/format";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { prodBar, prodConfirmed, prodRefusalText, prodStatus, refusalText } from "./deploy-model";
import { DeployStatePill } from "./deploy-state-pill";
import { StageList } from "./deploy-timeline";
import type { Announcement } from "./run-toasts";
import { useActivityClient } from "./activity-client";

export function DeployProd({
  editable,
  isAdmin,
  production,
  run,
  problems,
  productCode,
  activityDataBranch,
  onRun,
  onSettled,
  onAnnounce,
}: {
  /** Whether the viewer owns the project. */
  editable: boolean;
  /** Whether the viewer is a server admin: PROD is an admin's who owns the project. */
  isAdmin: boolean;
  production: DeployProductionState;
  /** The activity's latest run, QA's or PROD's. */
  run: DeployRun | null;
  /** What the readiness strip above lists, which the lane points to rather than repeats. */
  problems: readonly DeployProblem[];
  productCode: string;
  /** The activity-data branch QA deployed, which PROD deploys too. */
  activityDataBranch: string;
  onRun: (run: DeployRun) => void;
  /** A start was refused because the state shown was out of date: read it again. */
  onSettled: () => void;
  onAnnounce: (announcement: Announcement) => void;
}) {
  const { api } = useActivityClient();
  const words = S.activities.deploy;
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const bar = prodBar(production, run, formatDateTime, problems);
  const state = prodStatus(production, run);
  const running = run?.status === "running";
  const prodRunning = running && run?.target === "prod";
  const confirmed = prodConfirmed(typed, productCode);

  function close() {
    setOpen(false);
    setTyped("");
  }

  async function begin(
    stage: "prod" | "await_production_deploy",
    confirm: string,
    started: string,
  ) {
    setBusy(true);
    setError(null);
    try {
      const value = await api.deploy.start({ stage, target: "prod", confirm });
      if (!alive.current) return;
      close();
      onRun(value.run);
      onAnnounce({ kind: "info", text: started });
    } catch (cause) {
      if (!alive.current) return;
      close();
      const code = cause instanceof ApiError ? cause.code : undefined;
      const blocked = code === "deploy_blocked" || code === "deploy_running";
      setError(
        prodRefusalText(code) ??
          (blocked ? refusalText((cause as ApiError).detail) : null) ??
          apiErrorText(cause),
      );
      if (blocked) onSettled();
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  function start() {
    if (confirmed) void begin("prod", typed, words.prod.started);
  }

  // Waiting deploys nothing, so it asks for no typed code; the server still takes the product
  // code every PROD start carries.
  function wait() {
    void begin("await_production_deploy", productCode, words.prod.waitStarted);
  }

  return (
    <section
      className="min-w-0 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800"
      aria-labelledby="activity-deploy-prod-title"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
        <h4
          id="activity-deploy-prod-title"
          className="flex items-center gap-2 text-sm font-semibold"
        >
          {words.prod.title}
          <InfoPopover label={words.prod.title}>
            <p>{words.prod.about}</p>
          </InfoPopover>
        </h4>
        <DeployStatePill tone={state.tone} text={state.text} testId="deploy-prod-state" />
        <span className="flex-1" />
        {editable &&
          (isAdmin ? (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={bar.wait ? "secondary" : "primary"}
                disabled={busy || running || bar.blocker !== null}
                aria-describedby={!running && bar.blocker ? "deploy-prod-blocker" : undefined}
                aria-busy={busy}
                onClick={() => {
                  setError(null);
                  setOpen(true);
                }}
              >
                {prodRunning ? words.prod.deploying : words.prod.deploy}
              </Button>
              {bar.wait && (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy || bar.wait.blocker !== null}
                  aria-describedby="deploy-prod-wait"
                  aria-busy={busy}
                  onClick={wait}
                >
                  {words.prod.wait}
                </Button>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400" data-testid="deploy-prod-admin">
              {words.prod.adminOnly}
            </p>
          ))}
      </div>
      <div className="space-y-3 px-4 py-3">
        {!running && bar.wait && (
          <p
            id="deploy-prod-wait"
            className={`text-xs ${bar.wait.blocker ? "text-gray-600 dark:text-gray-300" : toneInk.attention}`}
            data-testid="deploy-prod-wait"
          >
            {bar.wait.blocker ?? words.prod.waitFirst}
          </p>
        )}
        {/* Deploy to PROD's own reason; while waiting comes first, being ready goes unsaid. */}
        {!running && (bar.blocker || !bar.wait) && (
          <p
            id="deploy-prod-blocker"
            className={`text-xs ${bar.blocker ? "text-gray-600 dark:text-gray-300" : toneInk.success}`}
            data-testid="deploy-prod-blocker"
          >
            {bar.blocker ?? words.prod.ready}
          </p>
        )}
        {bar.line && (
          <p
            role="status"
            className={`text-sm font-medium ${toneInk[bar.line.tone]}`}
            data-testid="deploy-prod-status"
          >
            {bar.line.text}
          </p>
        )}
        {error && (
          <p role="alert" className={`text-xs ${toneInk.danger}`}>
            {error}
          </p>
        )}
        <StageList rows={bar.rows} label={words.prod.stagesLabel} />
        <p
          className="flex flex-wrap items-center gap-x-3 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-gray-900 dark:text-gray-300"
          data-testid="deploy-prod-last"
        >
          <span>{bar.last}</span>
          {bar.lastUrl && (
            <a
              href={bar.lastUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              {words.prod.openDeploy}
            </a>
          )}
        </p>
      </div>
      <ConfirmModal
        open={open}
        title={words.prod.confirmTitle}
        tone="primary"
        confirmLabel={words.prod.confirmButton}
        confirmDisabled={!confirmed}
        busy={busy}
        onClose={close}
        onConfirm={start}
      >
        <div className="space-y-3">
          <div className="space-y-1 text-sm text-gray-600 dark:text-gray-300">
            <p>{words.prod.confirm(productCode)}</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>{words.prod.confirmItems.data(activityDataBranch)}</li>
              <li>{words.prod.confirmItems.jenkins}</li>
            </ul>
          </div>
          <Input
            size="sm"
            label={words.prod.confirmLabel(productCode)}
            hint={words.prod.confirmHint}
            value={typed}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setTyped(event.target.value)}
          />
        </div>
      </ConfirmModal>
    </section>
  );
}
