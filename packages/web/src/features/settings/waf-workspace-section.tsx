/**
 * WAF workspace (admin only, server-global): the checkouts activities are authored, played
 * and deployed from — framework, navbar, media and activity data — which WAF Harness clones and
 * keeps under its data folder, or an existing checkout it only reads, and optionally a monorepo's
 * modules folder product modules are also opened from. Prepare clones what is
 * missing on the server and takes minutes, so the page asks again every couple of seconds
 * while it runs. At the top, how activity runs work here (confined, and for how long), each saved
 * the moment it changes. Below, the remotes and branches it clones from; nothing is written until
 * Save.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { WafWorkspaceSettings, WafWorkspaceStatus } from "@waterford/waf-harness-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { toneInk } from "../../lib/tone";
import {
  Button,
  FieldError,
  FieldHint,
  FieldLabel,
  Input,
  toastError,
  toastInfo,
  toastSuccess,
  SettingsSection,
  useSaving,
  useUnsavedChanges,
} from "@waterford/waf-harness-ui";
import { SETTINGS_SCOPE } from "../../lib/unsaved/scopes";
import { useProject } from "../../state/project";
import { WorkspaceSelect } from "../chat/workspace-select";
import { ActivityRunLimitRow } from "./activity-run-limit-row";
import { ActivitySandboxRow } from "./activity-sandbox-row";
import {
  WAF_REPO_ORDER,
  WAF_WORKSPACE_POLL_MS,
  shouldPollWafWorkspace,
  wafFormFromSettings,
  wafWorkspaceUpdate,
  wafWorkspaceView,
  type WafWorkspaceForm,
} from "./waf-workspace";

export function WafWorkspaceSection() {
  const words = S.settings.wafWorkspace;
  // Browsing the server's folders is authorised through a project; any open one will do.
  const projectId = useProject().currentProject?.projectId ?? null;
  const [status, setStatus] = useState<WafWorkspaceStatus | null>(null);
  const [settings, setSettings] = useState<WafWorkspaceSettings | null>(null);
  const [form, setForm] = useState<WafWorkspaceForm>({});
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Whether this page started or watched a preparation, so its end is announced once. */
  const watching = useRef(false);
  const failures = useRef(0);
  const [retry, setRetry] = useState(0);

  const load = useCallback(async () => {
    try {
      const next = (await api.adminGetWafWorkspace()).status;
      if (watching.current && !next.preparing) {
        watching.current = false;
        if (next.ready && next.lastError === null) toastSuccess(words.prepared);
      }
      failures.current = 0;
      setStatus(next);
    } catch (e) {
      if (failures.current === 0) toastError(apiErrorText(e));
      failures.current += 1;
      setRetry((n) => n + 1);
    }
  }, [words]);

  const adopt = (next: WafWorkspaceSettings) => {
    setSettings(next);
    setForm(wafFormFromSettings(next));
  };

  useEffect(() => {
    void load();
    let cancelled = false;
    void api
      .adminGetWafWorkspaceSettings()
      .then((res) => {
        if (!cancelled) adopt(res.settings);
      })
      .catch((e: unknown) => {
        if (!cancelled) toastError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    if (!shouldPollWafWorkspace(status)) return;
    watching.current = true;
    const timer = window.setTimeout(() => void load(), WAF_WORKSPACE_POLL_MS);
    return () => window.clearTimeout(timer);
  }, [status, retry, load]);

  const prepare = async () => {
    setBusy(true);
    try {
      setStatus((await api.adminPrepareWafWorkspace()).status);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (settings === null || busy) return;
    const update = wafWorkspaceUpdate(form, settings);
    if (update === null) {
      toastInfo(S.common.noChangesToSave);
      return;
    }
    setBusy(true);
    setFieldError(null);
    try {
      adopt((await api.adminPutWafWorkspaceSettings(update)).settings);
      toastSuccess(S.common.saved);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.code === "waf_workspace_invalid" && e.details?.field)
        setFieldError(e.details.field);
      else toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  // The remotes and branches are a draft of the Settings dialog: a rail switch or a close with
  // edits not saved asks first, and a request in flight holds the dialog open until it answers.
  const dirty = settings !== null && wafWorkspaceUpdate(form, settings) !== null;
  useUnsavedChanges(dirty, {
    scope: SETTINGS_SCOPE,
    discard: () => {
      if (settings !== null) adopt(settings);
    },
  });
  useSaving(busy, SETTINGS_SCOPE);
  const view = status === null ? null : wafWorkspaceView(status);
  const hydrated = settings !== null;
  /** A server folder: picked through the open project, or typed when none is open. */
  const folderField = (
    path: "externalRoot" | "modulesRoot",
    label: string,
    hint: string,
    pick: string,
    clear: string,
  ) =>
    projectId === null ? (
      field(path, label, hint)
    ) : (
      <div>
        <FieldLabel>{label}</FieldLabel>
        <WorkspaceSelect
          projectId={projectId}
          workspace={form[path] ?? ""}
          onChange={(dir) => setForm((current) => ({ ...current, [path]: dir }))}
          variant="form"
          fieldLabel={label}
          emptyLabel={pick}
          clearable
          clearLabel={clear}
        />
        {fieldError === path ? (
          <FieldError>{words.invalid}</FieldError>
        ) : (
          <FieldHint>{hint}</FieldHint>
        )}
      </div>
    );
  const field = (path: string, label: string, hint?: string) => (
    <Input
      key={path}
      label={label}
      size="sm"
      value={form[path] ?? ""}
      disabled={!hydrated || busy}
      onChange={(event) => setForm((current) => ({ ...current, [path]: event.target.value }))}
      {...(hint ? { hint } : {})}
      {...(fieldError === path ? { error: words.invalid } : {})}
    />
  );
  return (
    <SettingsSection
      actions={
        <>
          <Button
            size="sm"
            disabled={view === null || !view.canPrepare || busy}
            onClick={() => void prepare()}
          >
            {words.prepare}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!hydrated || busy}
            onClick={() => void save()}
          >
            {S.common.save}
          </Button>
        </>
      }
    >
      <ActivitySandboxRow />
      <ActivityRunLimitRow />
      <div aria-live="polite">
        {view !== null && (
          <p
            className={`text-sm font-medium ${toneInk[view.tone]}`}
            data-testid="waf-workspace-status"
          >
            {view.line}
          </p>
        )}
        {view?.modules && (
          <p className={`mt-3 text-sm ${toneInk[view.modules.tone]}`}>{view.modules.line}</p>
        )}
        {view?.failure && (
          <p className={`mt-3 text-sm ${toneInk.danger}`}>{words.failed(view.failure)}</p>
        )}
      </div>
      {view !== null && view.repos.length > 0 && (
        <ul className="space-y-2">
          {view.repos.map((repo) => (
            <li key={repo.id}>
              <p className="text-sm">
                <span className="font-medium">{words.repos[repo.id]}</span>
                {": "}
                <span className={toneInk[repo.tone]}>{repo.line}</span>
              </p>
              <p className="break-all text-xs text-gray-500 dark:text-gray-400">{repo.path}</p>
            </li>
          ))}
        </ul>
      )}
      {view?.log && (
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{words.logLabel}</p>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border border-gray-200 bg-gray-50 p-2 font-mono text-xs dark:border-gray-800 dark:bg-gray-900/60">
            {view.log}
          </pre>
        </div>
      )}
      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-semibold">{words.sources}</legend>
        {WAF_REPO_ORDER.map((id) => (
          <div key={id} className="grid gap-3 sm:grid-cols-[1fr_10rem]">
            {field(`repos.${id}.remote`, words.remote(words.repos[id]))}
            {field(`repos.${id}.branch`, words.branch)}
          </div>
        ))}
        {field("moduleRemote", words.moduleRemote, words.moduleRemoteHint)}
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-semibold">{words.existing}</legend>
        {folderField(
          "externalRoot",
          words.externalRoot,
          words.externalRootHint,
          words.externalRootPick,
          words.externalRootClear,
        )}
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-semibold">{words.monorepo}</legend>
        {folderField(
          "modulesRoot",
          words.modulesRoot,
          words.modulesRootHint,
          words.modulesRootPick,
          words.modulesRootClear,
        )}
      </fieldset>
    </SettingsSection>
  );
}
