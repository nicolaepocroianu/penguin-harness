/**
 * Deploy: whether a deploy of this activity could start now and, when it cannot, what is
 * missing, each problem beside the press that clears it (Prepare clones, Check remote, or the
 * settings page an admin fills in). Then the QA pipeline, QA and PROD side by side, and the
 * repository checks, folded. Every press is explicit, and a release asks before it pushes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DeployContext,
  DeployContextResponse,
  DeployRun,
  DeployStateResponse,
} from "@prismshadow/penguin-server/api";
import { apiFetch } from "../../api/client";
import { Button } from "../../components/ui/button";
import { InfoPopover } from "../../components/ui/info-popover";
import { SkeletonList } from "../../components/ui/skeleton";
import {
  TABLE,
  TABLE_HEAD_ROW,
  TABLE_WRAP,
  TBODY,
  TD,
  TH,
} from "../../components/ui/table-classes";
import { apiErrorText } from "../../lib/api-error";
import { settingsDialog } from "../../lib/settings-dialog-store";
import { S } from "../../lib/strings";
import { toneDot, toneInk, toneStrip } from "../../lib/tone";
import { useAuth } from "../../state/auth";
import {
  checksSummary,
  readinessGroups,
  readinessLine,
  readinessBlocksStart,
  readinessRows,
  type ReadinessAction,
} from "./deploy-model";
import { DeployProd } from "./deploy-prod";
import { DeployQa } from "./deploy-qa";
import { DeployRelease } from "./deploy-release";
import type { Announcement } from "./run-toasts";

export function DeployPanel({
  endpoint,
  productCode,
  editable,
  pinnedBuild = false,
  onAnnounce,
}: {
  /** The activity's API path. */
  endpoint: string;
  /** The activity's product code, which the QA deploy's confirmation names. */
  productCode: string;
  /** Whether the viewer owns the project: only the owner prepares clones or asks the remote. */
  editable: boolean;
  /** Whether the preview plays a pinned module build, which a release does not ship. */
  pinnedBuild?: boolean;
  onAnnounce: (announcement: Announcement) => void;
}) {
  const words = S.activities.deploy;
  const { user } = useAuth();
  const [state, setState] = useState<DeployStateResponse | null>(null);
  const context = state?.context ?? null;
  const setContext = useCallback(
    (value: DeployContext) =>
      setState((current) => (current ? { ...current, context: value } : current)),
    [],
  );
  const setRun = useCallback(
    (run: DeployRun) => setState((current) => (current ? { ...current, run } : current)),
    [],
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"prepare" | "remote" | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const load = useCallback(
    async (checkRemote = false) => {
      const value = await apiFetch<DeployContextResponse>(
        `${endpoint}/deploy/context${checkRemote ? "?checkRemote=1" : ""}`,
      );
      return value.context;
    },
    [endpoint],
  );
  const loadState = useCallback(
    () => apiFetch<DeployStateResponse>(`${endpoint}/deploy`),
    [endpoint],
  );
  const reload = useCallback(() => {
    loadState()
      .then((value) => {
        if (alive.current) setState(value);
      })
      .catch((cause) => {
        if (alive.current) setActionError(apiErrorText(cause));
      });
  }, [loadState]);

  useEffect(() => {
    let cancelled = false;
    setState(null);
    setLoadError(null);
    loadState()
      .then((value) => {
        if (!cancelled) setState(value);
      })
      .catch((cause) => {
        if (!cancelled) setLoadError(apiErrorText(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [loadState]);

  async function prepare() {
    setBusy("prepare");
    setActionError(null);
    try {
      const value = await apiFetch<DeployContextResponse>(`${endpoint}/deploy/clones`, {
        method: "POST",
      });
      if (!alive.current) return;
      setContext(value.context);
      // The stages' blockers follow the clones.
      reload();
      onAnnounce({ kind: "success", text: words.prepared });
    } catch (cause) {
      if (alive.current) setActionError(apiErrorText(cause));
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  async function checkRemote() {
    setBusy("remote");
    setActionError(null);
    try {
      const value = await load(true);
      if (!alive.current) return;
      setContext(value);
      onAnnounce({ kind: "info", text: words.remoteChecked });
    } catch (cause) {
      if (alive.current) setActionError(apiErrorText(cause));
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  const line = context ? readinessLine(context) : null;
  const rows = context ? readinessRows(context) : [];
  const groups = context ? readinessGroups(context.problems) : [];
  const isAdmin = user?.isAdmin === true;

  /** The press that clears a group of problems, when this viewer may make it. */
  function actionButton(action: ReadinessAction | null) {
    switch (action) {
      case "prepareClones":
        return editable ? (
          <Button
            size="sm"
            variant="primary"
            disabled={busy !== null}
            aria-busy={busy === "prepare"}
            onClick={() => void prepare()}
          >
            {busy === "prepare" ? words.preparing : words.prepareClones}
          </Button>
        ) : null;
      case "checkRemote":
        return editable ? (
          <Button
            size="sm"
            disabled={busy !== null}
            aria-busy={busy === "remote"}
            onClick={() => void checkRemote()}
          >
            {busy === "remote" ? words.checkingRemote : words.checkRemote}
          </Button>
        ) : null;
      case "deploySettings":
        return isAdmin ? (
          <Button size="sm" onClick={() => settingsDialog.getState().open("deploy")}>
            {words.openSettings}
          </Button>
        ) : null;
      case "workspaceSettings":
        return isAdmin ? (
          <Button size="sm" onClick={() => settingsDialog.getState().open("wafWorkspace")}>
            {words.openWorkspaceSettings}
          </Button>
        ) : null;
      case null:
        return null;
    }
  }

  return (
    <section className="space-y-5" aria-labelledby="activity-deploy-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3
          id="activity-deploy-title"
          className="flex items-center gap-2 text-lg font-semibold tracking-tight"
        >
          {words.title}
          <InfoPopover label={words.title}>
            <p>{words.about}</p>
          </InfoPopover>
        </h3>
        {editable && (
          <Button
            size="sm"
            disabled={context === null || busy !== null}
            aria-busy={busy === "remote"}
            onClick={() => void checkRemote()}
          >
            {busy === "remote" ? words.checkingRemote : words.checkRemote}
          </Button>
        )}
      </div>
      {loadError && (
        <p role="alert" className={`text-xs ${toneInk.danger}`}>
          {words.loadFailed(loadError)}
        </p>
      )}
      {!loadError && !context && (
        <div role="status" aria-label={words.loading}>
          <SkeletonList rows={3} />
        </div>
      )}
      {actionError && (
        <p role="alert" className={`text-xs ${toneInk.danger}`}>
          {actionError}
        </p>
      )}
      {context && line && (
        <>
          {groups.length > 0 ? (
            <section
              aria-label={words.problemsTitle}
              className={`overflow-hidden rounded-xl border ${toneStrip.attention}`}
            >
              <p
                role="status"
                className="flex items-center gap-2 px-4 py-3 text-sm font-semibold"
                data-testid="deploy-readiness"
              >
                <span
                  aria-hidden
                  className={`size-1.5 shrink-0 rounded-full ${toneDot.attention}`}
                />
                {line.text}
              </p>
              <ul className="divide-y divide-gray-200 border-t border-gray-200 bg-white text-gray-900 dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
                {groups.map((group, index) => {
                  const action = actionButton(group.action);
                  return (
                    <li
                      key={`${group.action ?? "none"}:${index}`}
                      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1 space-y-1 text-sm">
                        {group.texts.map((text, at) => (
                          <p key={at}>{text}</p>
                        ))}
                        {group.action === "deploySettings" && (
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {words.settingsHint}
                          </p>
                        )}
                      </div>
                      {action}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : (
            <p
              role="status"
              className={`text-sm font-medium ${toneInk[line.tone]}`}
              data-testid="deploy-readiness"
            >
              {line.text}
            </p>
          )}
          {pinnedBuild && (
            <p
              role="status"
              className={`rounded-md border p-3 text-xs ${toneStrip.attention}`}
              data-testid="deploy-pinned-build"
            >
              {words.pinnedBuild}
            </p>
          )}
          {state && context.branches.deploy && (
            <DeployRelease
              endpoint={endpoint}
              editable={editable}
              run={state.run}
              stages={state.stages}
              branch={context.branches.deploy}
              activityDataBranch={context.branches.activityData}
              productCode={productCode}
              readinessBlocker={
                readinessBlocksStart(state.stages) ? words.waitingOnReadiness : null
              }
              onRun={setRun}
              onSettled={reload}
              onAnnounce={onAnnounce}
            />
          )}
          {state && context.branches.deploy && (
            <div className="grid gap-4 md:grid-cols-2">
              <DeployQa run={state.run} stages={state.stages} />
              {state.production && (
                <DeployProd
                  endpoint={endpoint}
                  editable={editable}
                  isAdmin={isAdmin}
                  production={state.production}
                  run={state.run}
                  productCode={productCode}
                  activityDataBranch={context.branches.activityData}
                  onRun={setRun}
                  onSettled={reload}
                  onAnnounce={onAnnounce}
                />
              )}
            </div>
          )}
          <details className="rounded-xl border border-gray-200 dark:border-gray-800">
            <summary className="cursor-pointer rounded-xl px-4 py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2">
              <span className="font-medium">{words.diagnostics}</span>{" "}
              <span className="text-xs text-gray-500 dark:text-gray-400">
                · {checksSummary(rows)}
              </span>
            </summary>
            <div className="px-4 pb-4">
              <div className={TABLE_WRAP}>
                <table className={TABLE} aria-label={words.checksLabel}>
                  <thead>
                    <tr className={TABLE_HEAD_ROW}>
                      <th className={TH}>{words.columns.check}</th>
                      <th className={TH}>{words.columns.state}</th>
                    </tr>
                  </thead>
                  <tbody className={TBODY}>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td className={`${TD} whitespace-nowrap font-medium`}>
                          <span className="flex items-center gap-2">
                            <span
                              aria-hidden
                              className={`size-1.5 shrink-0 rounded-full ${toneDot[row.tone]}`}
                            />
                            {row.label}
                          </span>
                        </td>
                        <td className={`${TD} break-words text-xs`}>{row.state}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
