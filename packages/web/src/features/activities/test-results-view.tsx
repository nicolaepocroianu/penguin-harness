/**
 * Test results, in the Module section below Quality: Run tests has the chosen agent write and
 * run one check per acceptance criterion against the played activity, and the latest report
 * shows each criterion with passed, failed or skipped, how long it took and why it failed.
 *
 * The run is an ordinary activity run, so the page's history polling follows it and its
 * Session shows its approvals; this view reads the report again once it settles.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ActivityRunSummary } from "@prismshadow/penguin-server/api";
import { ApiError } from "../../api/client";
import { Button } from "../../components/ui/button";
import { InfoPopover } from "../../components/ui/info-popover";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneDot, toneInk } from "../../lib/tone";
import { runStarted, useActivityClient } from "./activity-client";
import { reportVersion } from "./panel-badges";
import { indexRuns } from "./runs-index";
import { useResource } from "./use-resource";
import type { DraftBlock } from "./studio-draft";
import {
  TEST_TONE,
  countText,
  overallText,
  readTestState,
  resultRows,
  testBlocked,
  type TestState,
} from "./test-results-model";
import {
  TABLE,
  TABLE_HEAD_ROW,
  TABLE_WRAP,
  TBODY,
  TD,
  TH,
} from "../../components/ui/table-classes";

export function TestResultsView({
  runs,
  editable,
  runner,
  revision,
  blocked: gate,
}: {
  runs: ActivityRunSummary[];
  editable: boolean;
  /** Who writes and runs the tests, as the stage routes take it; null when no agent is chosen. */
  runner: Record<string, string> | null;
  /** The draft revision the tests start from. */
  revision: string;
  /** Why the draft holds Run tests back (its `tests` gate), or null. */
  blocked: DraftBlock | null;
}) {
  const words = S.activities.tests;
  const client = useActivityClient();
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const runIndex = indexRuns(runs);
  const latest = runIndex.latest("test");
  const running = latest?.status === "running";
  // Read again when the latest test run settles, or another one starts, or the draft changes
  // (its criteria may have).
  const settledKey = latest ? `${latest.runId}:${latest.status}` : "";
  const read = useResource(
    client.cache,
    client.api.tests.report,
    reportVersion(settledKey, revision),
  );
  const loadError = read.error ? apiErrorText(read.error) : null;
  // A start refused for want of the test browser says so until the next read.
  const [noBrowser, setNoBrowser] = useState<{ data: unknown } | null>(null);
  const state = useMemo((): TestState | null => {
    const current = read.data === undefined ? null : readTestState(read.data);
    if (!noBrowser || noBrowser.data !== read.data) return current;
    return {
      report: current?.report ?? null,
      runId: current?.runId ?? null,
      criteria: current?.criteria ?? 0,
      stale: current?.stale ?? false,
      browserInstalled: false,
    };
  }, [read.data, noBrowser]);

  const criteria = state?.criteria ?? 0;
  const blocked = testBlocked({
    gate,
    browserInstalled: state?.browserInstalled ?? true,
    criteria,
    starting,
  });

  async function start() {
    if (!runner) return;
    setStarting(true);
    setStartError(null);
    try {
      const run = await client.api.runs.start("test", runner, revision);
      if (alive.current) runStarted(client, run);
    } catch (cause) {
      if (!alive.current) return;
      if (cause instanceof ApiError && cause.code === "test_browser_missing")
        setNoBrowser({ data: read.data });
      else setStartError(apiErrorText(cause));
    } finally {
      if (alive.current) setStarting(false);
    }
  }

  const report = state?.report ?? null;
  const rows = report ? resultRows(report) : [];
  const count = report ? countText(report) : null;
  const lastFailed =
    latest && !running && latest.status !== "succeeded" && latest.runId !== state?.runId
      ? latest
      : null;
  const hint =
    blocked === "agent"
      ? words.noAgent
      : blocked === "unsaved"
        ? words.saveFirst
        : blocked === "browser"
          ? words.browserMissing
          : null;
  return (
    <section className="space-y-3" aria-labelledby="activity-tests-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="activity-tests-title" className="flex items-center gap-2 text-sm font-semibold">
          {words.title}
          <InfoPopover label={words.title}>
            <p>{words.about}</p>
          </InfoPopover>
        </h3>
        {editable && (
          <Button size="sm" disabled={blocked !== null} onClick={() => void start()}>
            {words.run}
          </Button>
        )}
      </div>
      {editable && hint && (
        <p className={`text-xs ${blocked === "browser" ? toneInk.attention : "text-gray-500"}`}>
          {hint}
        </p>
      )}
      {state && criteria === 0 && <p className="text-xs text-gray-500">{words.noCriteria}</p>}
      {running && (
        <p role="status" className="text-xs text-gray-500">
          {words.running}
        </p>
      )}
      {startError && (
        <p role="alert" className={`text-xs ${toneInk.danger}`}>
          {startError}
        </p>
      )}
      {lastFailed && (
        <p className={`text-xs ${toneInk.danger}`}>
          {words.lastFailed(lastFailed.error ?? S.activities.status[lastFailed.status])}
        </p>
      )}
      {loadError ? (
        <p role="alert" className={`text-xs ${toneInk.danger}`}>
          {words.loadFailed} {loadError}
        </p>
      ) : !report ? (
        <p className="text-xs text-gray-500">{words.notRun}</p>
      ) : (
        <>
          {state?.stale && (
            <p className={`text-xs ${toneInk.attention}`} data-testid="tests-stale">
              {words.stale}
            </p>
          )}
          <p
            className={`text-sm ${toneInk[TEST_TONE[report.overallStatus]]}`}
            data-testid="tests-status"
          >
            {overallText(report)}
            {count && <span className="text-gray-500 dark:text-gray-400"> · {count}</span>}
          </p>
          <p className="text-xs text-gray-500">
            {words.lastRun(new Date(report.checkedAt).toLocaleString())}
            {report.reused && ` · ${words.reused}`}
          </p>
          {rows.length > 0 && (
            <div className={TABLE_WRAP}>
              <table className={TABLE} aria-label={words.resultsLabel}>
                <thead>
                  <tr className={TABLE_HEAD_ROW}>
                    <th className={TH}>{words.columns.criterion}</th>
                    <th className={TH}>{words.columns.test}</th>
                    <th className={TH}>{words.columns.status}</th>
                    <th className={TH}>{words.columns.duration}</th>
                    <th className={TH}>{words.columns.error}</th>
                  </tr>
                </thead>
                <tbody className={TBODY}>
                  {rows.map((row) => (
                    <tr key={row.key}>
                      <td className={`${TD} break-words`}>{row.criterion}</td>
                      <td className={`${TD} break-words text-xs`}>{row.testName}</td>
                      <td className={`${TD} whitespace-nowrap`}>
                        <span className="flex items-center gap-1.5">
                          <span
                            aria-hidden="true"
                            className={`size-1.5 shrink-0 rounded-full ${toneDot[TEST_TONE[row.status]]}`}
                          />
                          {row.statusText}
                        </span>
                      </td>
                      <td className={`${TD} whitespace-nowrap text-xs`}>{row.duration}</td>
                      <td className={`${TD} break-words text-xs`}>{row.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
