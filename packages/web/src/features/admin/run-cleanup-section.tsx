/**
 * Activity storage (admin only, server-global): how much disk activity run folders take, and a
 * cleanup the admin starts by hand. "Find what can be removed" asks for a dry run and lists it per
 * category; "Clean up" confirms those numbers, and the server works the same choice out again and
 * removes only what is still eligible. Changing the choice drops the dry run, so what is confirmed
 * is always what was listed. Rendered as a page of the System settings dialog.
 */
import { useCallback, useEffect, useState } from "react";
import type { RunCleanupReport, RunStorage } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatBytes } from "../../lib/format";
import { toneInk } from "../../lib/tone";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { Input } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { SectionShell } from "../settings/section-shell";
import { PrefRow } from "../settings/setting-row";
import {
  KEEP_DEFAULT,
  KEEP_MAX,
  KEEP_MIN,
  answers,
  parseKeep,
  reportTotal,
} from "./run-cleanup-model";

/** One report's tallies, in the server's order. */
function ReportList({ report }: { report: RunCleanupReport }) {
  const strings = S.admin.runCleanup;
  return (
    <ul className="space-y-1 text-sm" data-testid="run-cleanup-report">
      {report.categories.map(({ category, items, bytes }) => (
        <li key={category} className="flex justify-between gap-4">
          <span>{strings.categories[category]}</span>
          <span className="shrink-0 tabular-nums text-gray-600 dark:text-gray-300">
            {category === "orphanTakes" ? strings.files(items) : strings.folders(items)}
            {items > 0 && `, ${formatBytes(bytes)}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function RunCleanupSection() {
  const strings = S.admin.runCleanup;
  const [storage, setStorage] = useState<RunStorage | null>(null);
  const [keepText, setKeepText] = useState(String(KEEP_DEFAULT));
  const [orphanTakes, setOrphanTakes] = useState(false);
  const [plan, setPlan] = useState<RunCleanupReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const keepNewest = parseKeep(keepText);
  const options = keepNewest === null ? null : { keepNewest, orphanTakes };
  // A dry run made for another choice no longer says what Clean up would remove.
  const shown = plan !== null && options !== null && answers(plan, options) ? plan : null;
  const total = shown ? reportTotal(shown) : null;

  const loadStorage = useCallback(async () => {
    try {
      setStorage((await api.adminRunStorage()).storage);
    } catch (e) {
      toastError(apiErrorText(e));
    }
  }, []);

  useEffect(() => {
    void loadStorage();
  }, [loadStorage]);

  const check = async () => {
    if (options === null) return;
    setBusy(true);
    try {
      setPlan((await api.adminRunCleanupPlan(options)).report);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const cleanUp = async () => {
    if (options === null) return;
    setBusy(true);
    try {
      const { report } = await api.adminRunCleanupApply(options);
      setConfirming(false);
      setPlan(null);
      const removed = strings.removed(formatBytes(reportTotal(report).bytes));
      if (report.failed > 0) toastError(`${removed} ${strings.leftInPlace(report.failed)}`);
      else toastSuccess(removed);
      await loadStorage();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionShell
      actions={
        <>
          <Button size="sm" disabled={options === null || busy} onClick={() => void check()}>
            {strings.check}
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={total === null || total.items === 0 || busy}
            onClick={() => setConfirming(true)}
          >
            {strings.cleanUp}
          </Button>
        </>
      }
    >
      <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
        <PrefRow label={strings.storage} info={strings.storageInfo}>
          <span className="text-sm tabular-nums" data-testid="run-storage">
            {storage === null
              ? S.common.loading
              : strings.storageLine(formatBytes(storage.bytes), storage.folders)}
          </span>
        </PrefRow>
        <PrefRow
          label={strings.keepNewest}
          info={strings.keepNewestInfo}
          hint={strings.keepNewestHint(KEEP_MIN, KEEP_MAX)}
        >
          <div className="w-20">
            <Input
              size="sm"
              type="number"
              inputMode="numeric"
              min={KEEP_MIN}
              max={KEEP_MAX}
              aria-label={strings.keepNewest}
              invalid={keepNewest === null}
              value={keepText}
              onChange={(event) => setKeepText(event.target.value)}
            />
          </div>
        </PrefRow>
        <PrefRow label={strings.orphanTakes} info={strings.orphanTakesInfo}>
          <Switch
            checked={orphanTakes}
            onChange={setOrphanTakes}
            aria-label={strings.orphanTakes}
          />
        </PrefRow>
      </div>
      {shown && (
        <div aria-live="polite">
          <p className="mb-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
            {strings.planHeading}
          </p>
          {total?.items === 0 ? (
            <p className="text-sm text-gray-600 dark:text-gray-300">{strings.nothing}</p>
          ) : (
            <ReportList report={shown} />
          )}
          {shown.unreadActivities > 0 && (
            <p className={`mt-2 text-xs ${toneInk.attention}`}>
              {strings.unread(shown.unreadActivities)}
            </p>
          )}
          {shown.takesUnavailable && (
            <p className={`mt-2 text-xs ${toneInk.attention}`}>{strings.takesUnavailable}</p>
          )}
        </div>
      )}
      <ConfirmModal
        open={confirming && shown !== null}
        title={strings.confirmTitle}
        confirmLabel={strings.confirmLabel}
        busy={busy}
        onClose={() => setConfirming(false)}
        onConfirm={() => void cleanUp()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">{strings.confirmBody}</p>
        {shown && (
          <div className="mt-2">
            <ReportList report={shown} />
          </div>
        )}
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{strings.confirmNote}</p>
      </ConfirmModal>
    </SectionShell>
  );
}
