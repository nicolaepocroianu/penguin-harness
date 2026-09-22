import { useCallback, useEffect, useState } from "react";
import type { SandboxBuildReport, SandboxStatus } from "@prismshadow/penguin-server/api";
import { apiFetch } from "../../api/client";
import { S } from "../../lib/strings";
import { toneStrip } from "../../lib/tone";
import { Button } from "../../components/ui/button";
import { InfoPopover } from "../../components/ui/info-popover";
import { canBuild, sandboxTone } from "./sandbox";

/**
 * What the harness knows about this activity's module, and the one action an author has.
 *
 * Separate from `ModulePreview`, which runs the bundle an assembly agent produced. This
 * reports the harness's own build of the same module and lets an author rebuild it, so a
 * failed build is something they can see and act on rather than a preview that never
 * appears.
 */
export function SandboxPanel({ projectId, activityId }: { projectId: string; activityId: string }) {
  const base = `/api/projects/${encodeURIComponent(projectId)}/activities/${encodeURIComponent(activityId)}/sandbox`;
  const [status, setStatus] = useState<SandboxStatus | null>(null);
  const [report, setReport] = useState<SandboxBuildReport | null>(null);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await apiFetch<SandboxStatus>(`${base}/status`));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [base]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const build = async () => {
    setBuilding(true);
    setError(null);
    try {
      // Forced: an author pressing Build after a build they believe failed is asking for a
      // build, not a freshness opinion.
      setReport(
        await apiFetch<SandboxBuildReport>(`${base}/build`, {
          method: "POST",
          body: { force: true },
        }),
      );
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBuilding(false);
    }
  };

  if (!status && !error) return null;
  // The last build's output, whichever call produced it. A failed build is only readable in
  // full, so it is shown rather than summarised.
  const log = report?.ok === false ? report.log : (status?.buildLog ?? null);

  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {S.activities.sandboxTitle}
        <InfoPopover label={S.activities.sandboxTitle}>
          <p>{S.activities.sandboxHelp}</p>
        </InfoPopover>
      </h3>
      {status && (
        <p
          role="status"
          className={`rounded-md border p-3 text-xs ${toneStrip[sandboxTone(status)]}`}
        >
          {status.message}
        </p>
      )}
      {report && (
        <p
          role="status"
          className={`rounded-md border p-3 text-xs ${toneStrip[report.ok ? "success" : "danger"]}`}
        >
          {report.message}
        </p>
      )}
      {error && (
        <p role="alert" className={`rounded-md border p-3 text-xs ${toneStrip.danger}`}>
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => void build()}
          disabled={building || !status || !canBuild(status)}
        >
          {building ? S.activities.sandboxBuilding : S.activities.sandboxBuild}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={building}>
          {S.activities.sandboxRefresh}
        </Button>
      </div>
      {log && (
        <details>
          <summary className="cursor-pointer text-xs text-gray-500">
            {S.activities.sandboxLog}
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-gray-200 bg-gray-50 p-3 text-xs whitespace-pre-wrap dark:border-gray-800 dark:bg-gray-900">
            {log}
          </pre>
        </details>
      )}
    </section>
  );
}
