/**
 * Activity outcomes (admin only): the outcome ledger, read. One run kind at a time, its runs are
 * counted per recipe or per runtime over a window of time and, when chosen, one project; selecting
 * a row lists that tally's newest runs, and selecting a run shows what happened to it. Nothing
 * here writes: it reads the ledger's admin routes and nothing else. Rendered as a page of the
 * System settings dialog.
 */
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { OutcomeFact, OutcomeRun, OutcomeTally } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime } from "../../lib/format";
import { toneInk } from "../../lib/tone";
import { useAuth } from "../../state/auth";
import { Button } from "../../components/ui/button";
import { InfoPopover } from "../../components/ui/info-popover";
import { Segmented } from "../../components/ui/segmented";
import { Select } from "../../components/ui/select";
import {
  TABLE,
  TABLE_HEAD_ROW,
  TABLE_WRAP,
  TBODY,
  TD,
  TH,
} from "../../components/ui/table-classes";
import { runKindLabel } from "../activities/run-toasts";
import {
  OUTCOME_KINDS,
  OUTCOME_WINDOWS,
  RUNS_LISTED,
  factDetail,
  outcomeRow,
  recipeParts,
  shortKey,
  windowSince,
  type OutcomeGrouping,
  type OutcomeKind,
  type OutcomeWindow,
} from "./activity-outcomes-model";

/** The runs list a tally row opens, which its toggle names as what it controls. */
const RUNS_SECTION_ID = "activity-outcomes-runs";

/** What a read is doing: still loading, failed, or done. */
type Loaded<T> =
  { state: "loading" } | { state: "failed"; reason: string } | { state: "ready"; value: T };

/** Reads `read` whenever `key` changes, dropping an answer that arrives after a newer request. */
function useRead<T>(key: string | null, read: () => Promise<T>): Loaded<T> | null {
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null);
  useEffect(() => {
    if (key === null) {
      setLoaded(null);
      return;
    }
    let current = true;
    setLoaded({ state: "loading" });
    read().then(
      (value) => current && setLoaded({ state: "ready", value }),
      (error: unknown) => current && setLoaded({ state: "failed", reason: apiErrorText(error) }),
    );
    return () => {
      current = false;
    };
    // `read` closes over what `key` names; the key is what decides a new read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return loaded;
}

export function ActivityOutcomesSection() {
  const { user } = useAuth();
  const words = S.admin.activityOutcomes;
  const [kind, setKind] = useState<OutcomeKind>("module");
  const [by, setBy] = useState<OutcomeGrouping>("recipe");
  const [range, setRange] = useState<OutcomeWindow>("30d");
  const [projectId, setProjectId] = useState("");
  const [chosen, setChosen] = useState<OutcomeTally | null>(null);
  const [run, setRun] = useState<OutcomeRun | null>(null);
  const isAdmin = user?.isAdmin === true;

  // The window is fixed as it is chosen, so reading again does not move it.
  const since = useMemo(() => windowSince(range, new Date()), [range]);
  const query = useMemo(
    () => ({
      kind,
      by,
      ...(projectId ? { projectId } : {}),
      ...(since ? { since } : {}),
    }),
    [kind, by, projectId, since],
  );
  const projects = useRead(
    isAdmin ? "projects" : null,
    async () => (await api.adminOutcomeProjects()).projects,
  );
  const tallies = useRead(
    isAdmin ? JSON.stringify(query) : null,
    async () => (await api.adminOutcomeTally(query)).tallies,
  );
  const runs = useRead(
    chosen ? JSON.stringify([query, chosen.key]) : null,
    async () => (await api.adminOutcomeRuns({ ...query, key: chosen!.key })).runs,
  );
  const history = useRead(
    run ? run.runId : null,
    async () =>
      (await api.adminOutcomeHistory(run!.projectId, run!.activityId, run!.runId)).runs[0]?.facts ??
      [],
  );

  // A new query leaves whatever was opened under the last one.
  useEffect(() => {
    setChosen(null);
    setRun(null);
  }, [query]);

  // Never offered to anyone else; render nothing rather than half a surface if reached anyway.
  if (user && !isAdmin) return null;

  /** A tally's name: who answered, a recipe's short id, or none for runs without that part. */
  const tallyName = (tally: OutcomeTally): string => {
    if (tally.key === null) return words.noKey;
    if (by === "runtime") return tally.key;
    return shortKey(tally.key);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          size="sm"
          label={words.kind}
          value={kind}
          onChange={(event) => setKind(event.target.value as OutcomeKind)}
        >
          {OUTCOME_KINDS.map((value) => (
            <option key={value} value={value}>
              {runKindLabel({ kind: value })}
            </option>
          ))}
        </Select>
        <Select
          size="sm"
          label={words.project}
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
        >
          <option value="">{words.allProjects}</option>
          {(projects?.state === "ready" ? projects.value : []).map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </Select>
        <div role="group" aria-label={words.groupBy}>
          <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">{words.groupBy}</p>
          <Segmented
            cols={2}
            value={by}
            onChange={setBy}
            options={[
              { value: "recipe", label: words.byRecipe },
              { value: "runtime", label: words.byRuntime },
            ]}
          />
        </div>
        <div role="group" aria-label={words.window}>
          <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">{words.window}</p>
          <Segmented
            cols={4}
            value={range}
            onChange={setRange}
            options={OUTCOME_WINDOWS.map((value) => ({ value, label: words.windows[value] }))}
          />
        </div>
      </div>

      <ReadView loaded={tallies}>
        {(value) =>
          value.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">{words.empty}</p>
          ) : (
            <TallyTable
              tallies={value}
              by={by}
              chosen={chosen}
              name={tallyName}
              onChoose={(tally) => {
                setChosen(chosen?.key === tally.key ? null : tally);
                setRun(null);
              }}
            />
          )
        }
      </ReadView>

      {chosen && (
        <section
          id={RUNS_SECTION_ID}
          aria-labelledby={`${RUNS_SECTION_ID}-title`}
          className="space-y-2"
        >
          <h4 id={`${RUNS_SECTION_ID}-title`} className="text-sm font-medium">
            {words.runsTitle(tallyName(chosen))}
          </h4>
          <ReadView loaded={runs}>
            {(value) => <RunTable runs={value} open={run} onOpen={setRun} />}
          </ReadView>
        </section>
      )}

      {run && (
        <section aria-labelledby="activity-outcomes-history" className="space-y-2">
          <h4 id="activity-outcomes-history" className="text-sm font-medium">
            {words.historyTitle(run.runId)}
          </h4>
          <ReadView loaded={history}>{(value) => <FactList facts={value} />}</ReadView>
        </section>
      )}
    </div>
  );
}

/** What a read shows: that it is loading, why it failed, or what `children` makes of its value. */
function ReadView<T>({
  loaded,
  children,
}: {
  loaded: Loaded<T> | null;
  children: (value: T) => ReactNode;
}) {
  if (loaded === null || loaded.state === "loading")
    return <p className="text-sm text-gray-400">{S.common.loading}</p>;
  if (loaded.state === "failed")
    return (
      <p role="alert" className={`text-xs ${toneInk.danger}`}>
        {S.admin.activityOutcomes.loadFailed(loaded.reason)}
      </p>
    );
  return <>{children(loaded.value)}</>;
}

function TallyTable({
  tallies,
  by,
  chosen,
  name,
  onChoose,
}: {
  tallies: readonly OutcomeTally[];
  by: OutcomeGrouping;
  chosen: OutcomeTally | null;
  name: (tally: OutcomeTally) => string;
  onChoose: (tally: OutcomeTally) => void;
}) {
  const words = S.admin.activityOutcomes;
  const columns = words.columns;
  const withInfo = (title: string, info: string) => (
    <span className="inline-flex items-center gap-1">
      {title}
      <InfoPopover label={title}>{info}</InfoPopover>
    </span>
  );
  return (
    <div className={TABLE_WRAP}>
      <table className={TABLE} aria-label={words.title}>
        <thead>
          <tr className={TABLE_HEAD_ROW}>
            <th className={TH}>{by === "recipe" ? columns.recipe : columns.runtime}</th>
            <th className={`${TH} text-right`}>{columns.runs}</th>
            <th className={`${TH} text-right`}>{columns.succeeded}</th>
            <th className={`${TH} text-right`}>
              {withInfo(columns.repaired, words.columnInfo.repaired)}
            </th>
            <th className={`${TH} text-right`}>{columns.accepted}</th>
            <th className={`${TH} text-right`}>
              {withInfo(columns.edits, words.columnInfo.edits)}
            </th>
            <th className={`${TH} text-right`}>{columns.reverted}</th>
            <th className={`${TH} text-right`}>{columns.deployed}</th>
            <th className={`${TH} text-right`}>
              {withInfo(columns.untrusted, words.columnInfo.untrusted)}
            </th>
          </tr>
        </thead>
        <tbody className={TBODY}>
          {tallies.map((tally) => {
            const row = outcomeRow(tally);
            const parts = tally.recipe ? recipeParts(tally.recipe) : null;
            const open = chosen?.key === tally.key;
            return (
              <tr key={tally.key ?? ""} data-testid="outcome-tally">
                <td className={TD}>
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={RUNS_SECTION_ID}
                    aria-label={words.showRuns(name(tally))}
                    onClick={() => onChoose(tally)}
                    className="text-left font-medium text-gray-900 underline-offset-2 hover:underline dark:text-gray-100"
                  >
                    {parts ? parts.runtime : name(tally)}
                  </button>
                  {parts && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {shortKey(tally.key ?? "")} ·{" "}
                      {words.recipeDetail(
                        parts.penguin,
                        parts.libraries.join(", ") || words.noSkills,
                        parts.harness,
                      )}
                    </p>
                  )}
                </td>
                <td className={`${TD} text-right tabular-nums`}>{row.runs}</td>
                <td className={`${TD} whitespace-nowrap text-right tabular-nums`}>
                  {words.rate(row.succeeded, row.successPercent)}
                </td>
                <td className={`${TD} text-right tabular-nums`}>{row.repaired}</td>
                <td className={`${TD} text-right tabular-nums`}>{row.accepted}</td>
                <td className={`${TD} text-right tabular-nums`}>{row.edits}</td>
                <td className={`${TD} text-right tabular-nums`}>{row.reverted}</td>
                <td className={`${TD} whitespace-nowrap text-right tabular-nums`}>
                  {row.deployedQa} / {row.deployedProd}
                </td>
                <td
                  className={`${TD} text-right tabular-nums ${row.untrusted > 0 ? toneInk.attention : ""}`}
                >
                  {row.untrusted}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RunTable({
  runs,
  open,
  onOpen,
}: {
  runs: readonly OutcomeRun[];
  open: OutcomeRun | null;
  onOpen: (run: OutcomeRun) => void;
}) {
  const words = S.admin.activityOutcomes;
  if (runs.length === 0)
    return <p className="text-sm text-gray-500 dark:text-gray-400">{words.runsEmpty}</p>;
  return (
    <>
      <div className={TABLE_WRAP}>
        <table className={TABLE}>
          <thead>
            <tr className={TABLE_HEAD_ROW}>
              <th className={TH}>{words.runColumns.started}</th>
              <th className={TH}>{words.runColumns.project}</th>
              <th className={TH}>{words.runColumns.activity}</th>
              <th className={TH}>{words.runColumns.status}</th>
              <th className={TH}>
                <span className="sr-only">{words.history}</span>
              </th>
            </tr>
          </thead>
          <tbody className={TBODY}>
            {runs.map((run) => (
              <tr key={run.runId} data-testid="outcome-run">
                <td className={`${TD} whitespace-nowrap text-gray-500 dark:text-gray-400`}>
                  {formatDateTime(run.startedAt)}
                </td>
                <td className={TD}>{run.projectId}</td>
                <td className={`${TD} font-mono text-xs`}>{run.activityId}</td>
                <td className={TD}>{words.runStatus[run.status]}</td>
                <td className={`${TD} text-right`}>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-pressed={open?.runId === run.runId}
                    onClick={() => onOpen(run)}
                  >
                    {words.history}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {runs.length >= RUNS_LISTED && (
        <p className="text-xs text-gray-500 dark:text-gray-400">{words.runsLimited(runs.length)}</p>
      )}
    </>
  );
}

function FactList({ facts }: { facts: readonly OutcomeFact[] }) {
  const words = S.admin.activityOutcomes;
  if (facts.length === 0)
    return <p className="text-sm text-gray-500 dark:text-gray-400">{words.historyEmpty}</p>;
  return (
    <ol className="space-y-1 text-xs" data-testid="outcome-history">
      {facts.map((fact, index) => (
        <li key={`${fact.fact}-${index}`} className="flex flex-wrap gap-x-2">
          <span className="whitespace-nowrap text-gray-500 dark:text-gray-400">
            {formatDateTime(fact.at)}
          </span>
          <span className="font-medium">{words.facts[fact.fact] ?? fact.fact}</span>
          <span className="break-all text-gray-600 dark:text-gray-300">
            {factDetail(fact.detail)}
          </span>
        </li>
      ))}
    </ol>
  );
}
