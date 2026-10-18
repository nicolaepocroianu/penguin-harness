/**
 * The "Confine activity agents" switch at the top of the WAF workspace page: whether an
 * activity run's agent may change files only in its own run folder. Saved the moment it is
 * flipped, like the other switches in System settings, and followed by a line saying what the
 * setting means right now — including that runs will not start when it is on and no sandbox
 * is available.
 */
import { useCallback, useEffect, useState } from "react";
import type { ActivitySandboxState } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk, type Tone } from "../../lib/tone";
import { Button, Switch, toastError, toastSuccess, PrefRow } from "@prismshadow/penguin-ui";

/** The status line under the switch: what the current setting means, in its tone. */
export function activitySandboxLine(state: ActivitySandboxState): { tone: Tone; text: string } {
  const words = S.settings.wafWorkspace;
  if (!state.enabled) return { tone: "attention", text: words.confineAgentsOff };
  if (state.problem !== null) return { tone: "danger", text: words.confineAgentsUnavailable };
  return { tone: "success", text: words.confineAgentsReady };
}

export function ActivitySandboxRow() {
  const words = S.settings.wafWorkspace;
  const [state, setState] = useState<ActivitySandboxState | null>(null);
  const [busy, setBusy] = useState(false);
  // Why the setting could not be read, kept on screen with a way to try again: a toast alone
  // would leave the switch disabled and silent until the page is reopened.
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (isLive: () => boolean) => {
    setLoadError(null);
    try {
      const response = await api.adminGetActivitySandbox();
      if (isLive()) setState(response.sandbox);
    } catch (error) {
      if (isLive()) setLoadError(apiErrorText(error));
    }
  }, []);

  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => {
      live = false;
    };
  }, [load]);

  const change = async (enabled: boolean) => {
    setBusy(true);
    try {
      setState((await api.adminPutActivitySandbox(enabled)).sandbox);
      toastSuccess(words.confineAgentsSaved(enabled));
    } catch (error) {
      toastError(apiErrorText(error));
    } finally {
      setBusy(false);
    }
  };

  const line = state === null ? null : activitySandboxLine(state);
  return (
    <div className="divide-y divide-gray-200 dark:divide-gray-800">
      <PrefRow label={words.confineAgents} info={words.confineAgentsInfo}>
        <Switch
          checked={state?.enabled ?? true}
          disabled={state === null || busy}
          onChange={(enabled) => void change(enabled)}
          aria-label={words.confineAgents}
          data-testid="activity-sandbox-switch"
        />
      </PrefRow>
      {loadError !== null && (
        <div className="flex items-center justify-between gap-3 pt-2" aria-live="polite">
          <p className={`text-sm ${toneInk.danger}`} data-testid="activity-sandbox-error">
            {words.confineAgentsLoadFailed(loadError)}
          </p>
          <Button size="sm" onClick={() => void load(() => true)}>
            {S.common.retry}
          </Button>
        </div>
      )}
      {line !== null && (
        <p
          className={`pt-2 text-sm ${toneInk[line.tone]}`}
          aria-live="polite"
          data-testid="activity-sandbox-status"
        >
          {line.text}
        </p>
      )}
    </div>
  );
}
