/**
 * The Checks tool: everything that checks the activity, in one panel. First the player check
 * the playing build ran when it was assembled, then the acceptance tests, then the quality
 * checks, each with its own Run, since a run of one waits for any other run to end.
 */
import type { ActivityRunSummary } from "@waterford/waf-harness-server/api";
import { InfoPopover } from "@waterford/waf-harness-ui";
import {
  TABLE,
  TABLE_HEAD_ROW,
  TABLE_WRAP,
  TBODY,
  TD,
  TH,
} from "../../components/ui/table-classes";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime } from "../../lib/format";
import { S } from "../../lib/strings";
import { toneDot, toneInk } from "../../lib/tone";
import { useActivityClient } from "./activity-client";
import { readPlayerCheck } from "./checks-model";
import { QualityChecksView } from "./quality-checks-view";
import type { DraftBlock } from "./studio-draft";
import { TEST_TONE, resultRows, type ResultRow } from "./test-results-model";
import { TestResultsView } from "./test-results-view";
import { useResource } from "./use-resource";

export function ChecksPanel({
  runs,
  editable,
  runner,
  revision,
  playerCheckVersion,
  testsBlocked,
  qualityBlocked,
}: {
  runs: ActivityRunSummary[];
  editable: boolean;
  /** Who writes and runs the tests; null when no agent is chosen. */
  runner: Record<string, string> | null;
  revision: string;
  /** Which read of the player check: the one the rail's mark and the journey share. */
  playerCheckVersion: string;
  testsBlocked: DraftBlock | null;
  qualityBlocked: DraftBlock | null;
}) {
  return (
    <div className="divide-y divide-gray-200 dark:divide-gray-800">
      <div className="p-3">
        <PlayerCheckView version={playerCheckVersion} />
      </div>
      <div className="p-3">
        <TestResultsView
          runs={runs}
          editable={editable}
          runner={runner}
          revision={revision}
          blocked={testsBlocked}
        />
      </div>
      <div className="p-3">
        <QualityChecksView
          runs={runs}
          editable={editable}
          revision={revision}
          blocked={qualityBlocked}
        />
      </div>
    </div>
  );
}

/**
 * What the playing build's player check found: a line that says it, the scenarios that failed
 * open, and the ones that passed folded, since a passing check is the normal case.
 */
function PlayerCheckView({ version }: { version: string }) {
  const words = S.activities.checks.player;
  const { api, cache } = useActivityClient();
  const read = useResource(cache, api.playerCheck, version);
  const state = read.data === undefined ? null : readPlayerCheck(read.data);
  const report = state?.report ?? null;
  const rows = report ? resultRows(report) : [];
  const failed = rows.filter((row) => row.status === "failed");
  return (
    <section className="space-y-2" aria-labelledby="activity-player-check-title">
      <h3
        id="activity-player-check-title"
        className="flex items-center gap-2 text-sm font-semibold"
      >
        {words.title}
        <InfoPopover label={words.title}>
          <p>{words.about}</p>
        </InfoPopover>
      </h3>
      {read.error ? (
        <p role="alert" className={`text-xs ${toneInk.danger}`}>
          {words.loadFailed} {apiErrorText(read.error)}
        </p>
      ) : !state ? null : !state.runId ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">{words.none}</p>
      ) : !report ? (
        <p className={`text-xs ${toneInk.attention}`} data-testid="player-check-status">
          {state.gap === "noBrowser" ? words.noBrowser : words.notRun}
        </p>
      ) : (
        <>
          <p
            className={`text-sm ${toneInk[TEST_TONE[report.overallStatus]]}`}
            data-testid="player-check-status"
          >
            {playerCheckLine(failed.length, rows.length)}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {words.checkedAt(formatDateTime(report.checkedAt))}
          </p>
          {report.untrusted && <p className={`text-xs ${toneInk.attention}`}>{words.untrusted}</p>}
          {failed.length > 0 && <ScenarioTable rows={failed} status={false} />}
          {rows.length > failed.length && (
            <details className="text-xs">
              <summary className="cursor-pointer text-gray-600 dark:text-gray-300">
                {words.showAll(rows.length)}
              </summary>
              <div className="mt-2">
                <ScenarioTable rows={rows} />
              </div>
            </details>
          )}
        </>
      )}
    </section>
  );
}

/** The player check in one line: what failed, else that it passed, else that nothing ran. */
function playerCheckLine(failed: number, total: number): string {
  const words = S.activities.checks.player;
  if (failed) return words.failed(failed, total);
  if (total) return words.passed(total);
  return words.skipped;
}

/**
 * The scenarios in a table. The failed ones alone need no status column: the line above says
 * they failed, so every cell would repeat it.
 */
function ScenarioTable({ rows, status = true }: { rows: readonly ResultRow[]; status?: boolean }) {
  const words = S.activities.checks.player;
  const columns = S.activities.tests.columns;
  return (
    <div className={TABLE_WRAP}>
      <table className={TABLE} aria-label={words.resultsLabel}>
        <thead>
          <tr className={TABLE_HEAD_ROW}>
            <th className={TH}>{words.scenario}</th>
            {status && <th className={TH}>{columns.status}</th>}
            <th className={TH}>{columns.duration}</th>
            <th className={TH}>{columns.error}</th>
          </tr>
        </thead>
        <tbody className={TBODY}>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className={`${TD} break-words`}>{row.criterion}</td>
              {status && (
                <td className={`${TD} whitespace-nowrap`}>
                  <span className="flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className={`size-1.5 shrink-0 rounded-full ${toneDot[TEST_TONE[row.status]]}`}
                    />
                    {row.statusText}
                  </span>
                </td>
              )}
              <td className={`${TD} whitespace-nowrap text-xs`}>{row.duration}</td>
              <td className={`${TD} break-words text-xs`}>{row.error}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
