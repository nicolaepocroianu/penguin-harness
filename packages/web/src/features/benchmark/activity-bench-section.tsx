/**
 * The activity bench's scores in the Evaluation Center (admins only): the Benchmarks `pnpm bench`
 * keeps in its bench home, each with its scoreboard, read as they are. The admin chooses the bench
 * home once, with the server folder browser; the server reads only the bench's Benchmark folders
 * there, never writes to them, and nothing here runs the bench. Nothing on a board can be acted
 * on: it is a record of what the bench found.
 */
import { useEffect, useState } from "react";
import type { ActivityBenchBoard, ActivityBenchResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime, formatMoney, formatScore, humanizeDuration } from "../../lib/format";
import { toneInk } from "../../lib/tone";
import { useAuth } from "../../state/auth";
import { useTheme } from "../../state/theme";
import { FieldHint, FieldLabel, InfoPopover, toastError, Sparkline } from "@prismshadow/penguin-ui";
import {
  TABLE,
  TABLE_HEAD_ROW,
  TABLE_WRAP,
  TBODY,
  TD,
  TH,
} from "../../components/ui/table-classes";
import { WorkspaceSelect } from "../chat/workspace-select";
import { benchHomeChoice, newestFirst } from "./activity-bench-model";
import { latestWithDelta, sparklineSeries } from "./benchmark-metrics";

export function ActivityBenchSection({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const isAdmin = user?.isAdmin === true;
  const words = S.benchmark.activityBench;
  const [view, setView] = useState<ActivityBenchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let current = true;
    api.adminActivityBench().then(
      (value) => current && setView(value),
      (reason: unknown) => current && setError(apiErrorText(reason)),
    );
    return () => {
      current = false;
    };
  }, [isAdmin]);

  // The bench home is the server's to read, and only an admin may choose it or read it.
  if (!isAdmin) return null;

  const choose = async (picked: string) => {
    try {
      setView(await api.adminSetActivityBenchHome(benchHomeChoice(picked)));
      setError(null);
    } catch (reason) {
      toastError(apiErrorText(reason));
    }
  };

  let body = null;
  if (error !== null)
    body = (
      <p role="alert" className={`text-xs ${toneInk.danger}`}>
        {words.loadFailed(error)}
      </p>
    );
  else if (view === null) body = <p className="text-sm text-gray-400">{S.common.loading}</p>;
  else if (view.problem === "home_missing")
    body = <p className={`text-xs ${toneInk.attention}`}>{words.homeMissing}</p>;
  else if (view.home !== null && view.boards.length === 0)
    body = <p className="text-sm text-gray-500 dark:text-gray-400">{words.empty}</p>;
  else if (view.home !== null)
    body = (
      <div className="space-y-3">
        {view.boards.map((board) => (
          <BenchBoard key={`${board.project}/${board.id}`} board={board} />
        ))}
      </div>
    );

  return (
    <section aria-labelledby="activity-bench-title" className="mt-8 space-y-3">
      <h2 id="activity-bench-title" className="flex items-center gap-1.5 text-base font-semibold">
        {words.title}
        <InfoPopover label={words.title}>{words.about}</InfoPopover>
      </h2>
      <div className="max-w-xl">
        <FieldLabel>{words.home}</FieldLabel>
        <WorkspaceSelect
          projectId={projectId}
          workspace={view?.home ?? ""}
          onChange={(picked) => void choose(picked)}
          variant="form"
          fieldLabel={words.home}
          emptyLabel={words.homePick}
          clearable
          clearLabel={words.homeClear}
        />
        <FieldHint>{words.homeHint}</FieldHint>
      </div>
      {body}
    </section>
  );
}

/** One Benchmark of the bench, read-only: its latest score and every evaluation recorded. */
function BenchBoard({ board }: { board: ActivityBenchBoard }) {
  const words = S.benchmark.activityBench;
  const { currency } = useTheme();
  const latest = latestWithDelta(board.evaluations);
  const series = sparklineSeries(board.evaluations);
  return (
    <div
      className="space-y-3 rounded-md border border-gray-200 bg-white px-5 py-4 dark:border-gray-800 dark:bg-gray-900"
      data-testid="bench-board"
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="min-w-[14rem] flex-1">
          <p className="truncate text-base font-bold">{board.title}</p>
          <p className="mt-1 font-mono text-xs text-gray-500 dark:text-gray-400">
            {words.origin(board.project, board.id)}
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {S.benchmark.caseCount(board.caseCount)} · {S.benchmark.runsPerCase(board.runs ?? 1)}
          </p>
        </div>
        {series.length > 0 && (
          <Sparkline
            values={series}
            label={S.benchmark.sparklineLabel(series.length)}
            scale="range"
            marker
          />
        )}
        <div className="min-w-16 text-right">
          <span
            className="block font-mono text-sm font-semibold tabular-nums"
            data-tooltip={S.benchmark.latestScoreLabel}
          >
            {latest ? formatScore(latest.score) : "—"}
          </span>
        </div>
      </div>
      {board.evaluations.length > 0 && (
        <div className={TABLE_WRAP}>
          <table className={TABLE} aria-label={words.evaluationsLabel(board.title)}>
            <thead>
              <tr className={TABLE_HEAD_ROW}>
                <th className={TH}>{S.common.time}</th>
                <th className={TH}>{S.benchmark.colVersion}</th>
                <th className={TH}>{words.colSummary}</th>
                <th className={TH}>{S.benchmark.colModel}</th>
                <th className={`${TH} text-right`}>{S.benchmark.colScore}</th>
                <th className={`${TH} text-right`}>{S.common.cost}</th>
                <th className={`${TH} text-right`}>{S.benchmark.colDuration}</th>
              </tr>
            </thead>
            <tbody className={TBODY}>
              {newestFirst(board.evaluations).map((evaluation, index) => (
                <tr key={`${evaluation.time}-${index}`} data-testid="bench-evaluation">
                  <td
                    className={`${TD} whitespace-nowrap text-xs text-gray-500 dark:text-gray-400`}
                  >
                    {formatDateTime(evaluation.time)}
                  </td>
                  <td className={`${TD} font-mono text-xs`}>v{evaluation.version}</td>
                  <td className={`${TD} text-xs`}>{evaluation.summaryTitle ?? ""}</td>
                  <td className={`${TD} font-mono text-xs text-gray-500 dark:text-gray-400`}>
                    {evaluation.modelId}
                  </td>
                  <td className={`${TD} text-right font-mono text-xs font-semibold tabular-nums`}>
                    {formatScore(evaluation.score)}
                  </td>
                  <td className={`${TD} text-right font-mono text-xs tabular-nums`}>
                    {formatMoney(evaluation.cost, currency)}
                  </td>
                  <td className={`${TD} text-right font-mono text-xs tabular-nums`}>
                    {evaluation.durationMs !== undefined
                      ? humanizeDuration(evaluation.durationMs)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
