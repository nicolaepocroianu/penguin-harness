/**
 * The activity run time limit, under the "Confine activity agents" switch on the WAF workspace
 * page: how long any activity run may work before the server stops it, or each kind's own limit.
 * Saved the moment it is picked, like the switch above it, with a single PUT to
 * /api/admin/settings. It stays disabled until the stored value arrives and while a write is in
 * flight; a write that fails puts the stored value back and says why on the row.
 */
import { useEffect, useState } from "react";
import * as api from "../../api/endpoints";
import { Select, PrefRow } from "@prismshadow/penguin-ui";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { runLimitChoices, runLimitOf, runLimitValue } from "./run-limit";

export function ActivityRunLimitRow() {
  const words = S.settings.wafWorkspace;
  /** The limit the server last confirmed; undefined until the settings load. */
  const [stored, setStored] = useState<number | null | undefined>(undefined);
  /** What the picker shows: the pick being saved, else the stored limit. */
  const [shown, setShown] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const adopt = (minutes: number | null) => {
    setStored(minutes);
    setShown(minutes);
  };

  useEffect(() => {
    let cancelled = false;
    void api
      .adminGetSettings()
      .then((res) => {
        if (!cancelled) adopt(res.settings.activityRunLimitMinutes);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pick = async (value: string) => {
    if (stored === undefined || busy) return;
    const next = runLimitOf(value);
    if (next === stored) return;
    setShown(next);
    setError(undefined);
    setBusy(true);
    try {
      const res = await api.adminPutSettings({ activityRunLimitMinutes: next });
      adopt(res.settings.activityRunLimitMinutes);
    } catch (e) {
      setShown(stored);
      setError(apiErrorText(e));
    }
    setBusy(false);
  };

  return (
    // Its own block, so the row drops its outer padding like the switch's row above it and the
    // section's spacing alone sets it apart.
    <div>
      <PrefRow label={words.runLimit} info={words.runLimitInfo} hint={error}>
        {/* A Select fills its container: boxed to the width of its longest choice. */}
        <div className="w-40">
          <Select
            size="sm"
            value={runLimitValue(shown)}
            disabled={stored === undefined || busy}
            onChange={(e) => void pick(e.target.value)}
            aria-label={words.runLimit}
          >
            <option value="">{words.runLimitDefault}</option>
            {runLimitChoices(stored ?? null).map((minutes) => (
              <option key={minutes} value={runLimitValue(minutes)}>
                {words.runLimitMinutes(minutes)}
              </option>
            ))}
          </Select>
        </div>
      </PrefRow>
    </div>
  );
}
