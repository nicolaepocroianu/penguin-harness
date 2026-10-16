import fs from "node:fs/promises";
import path from "node:path";
import { Component, Interface, Use, type Opaque } from "@prismshadow/penguin-core/kernel";
import type { Config, Db, Log } from "../hmr/capabilities.js";
import type { ActivityRun, ActivityRunSummary } from "./domain.js";

/** Where every run's folder lives, under the server root. */
const RUNS_DIR = "activity-runs";

/**
 * Whether `workspace` is inside an activity run's folder (the run's own Session works there,
 * and so do its subagents).
 */
export function isRunWorkspace(root: string, workspace: string): boolean {
  const rel = path.relative(path.resolve(root, RUNS_DIR), path.resolve(workspace));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Activity runs as they are kept: each run's record, its candidate, and its folder. A run
 * is a row of `activity_runs` (status and kind as columns, the rest as `record_json`), its
 * candidate a row of `activity_run_candidates`, and its folder `activity-runs/<runId>`
 * under the server root. Nothing else reads or writes any of them.
 */
export abstract class ActivityRuns extends Interface<{
  /** Records a new run, as it is: running, with no candidate. */
  open(run: ActivityRun): void;
  /**
   * Writes a run's status and record, and its candidate when it has one; a null candidate
   * keeps the one already stored. Nothing for a run that was never opened.
   */
  save(run: ActivityRun): void;
  /** One run of the activity, with its candidate; null when the activity has no such run. */
  get(projectId: string, activityId: string, runId: string): ActivityRun | null;
  /**
   * The activity's runs, newest first: only those of `kind` and `status` when given, and no
   * more than `limit`.
   */
  summaries(
    projectId: string,
    activityId: string,
    query?: { kind?: ActivityRun["kind"]; status?: ActivityRun["status"]; limit?: number },
  ): ActivityRunSummary[];
  /** Every run still running, of every activity, without its candidate. */
  running(): ActivityRun[];
  /** Whether a run is still working on the activity. */
  hasActive(activityId: string): boolean;
  /** The run's folder, where its agent or the server does its work. */
  workspace(runId: string): string;
  /** Every run of a project, of every activity, by id. */
  projectRunIds(projectId: string): string[];
  /**
   * Removes these runs' folders. A link inside one (a module run's linked packages) is
   * removed, never what it points to. A folder that cannot be removed is left as it is, and
   * the server log names it.
   */
  removeWorkspaces(runIds: string[]): Promise<void>;
  /** The activity whose run the Session is, if it is one. */
  activityOfSession(sessionId: string): string | undefined;
  /** Every run Session of a project, session id to activity id, in one read. */
  sessionActivities(projectId: string): Opaque<"ActivityIdsBySession", Map<string, string>>;
}>() {}

type RunRow = { kind: ActivityRun["kind"]; record_json: string };

function summaryOf(row: RunRow): ActivityRunSummary {
  const metadata = JSON.parse(row.record_json) as ActivityRunSummary;
  return { ...metadata, kind: row.kind };
}

@Component()
export class ActivityRunStore implements ActivityRuns {
  @Use() private readonly db!: Db;
  @Use() private readonly config!: Config;
  @Use() private readonly log!: Log;

  open(run: ActivityRun): void {
    const { candidate: _candidate, kind: _kind, ...metadata } = run;
    this.db
      .prepare(
        "INSERT INTO activity_runs (run_id, project_id, activity_id, status, created_at, kind, record_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        run.runId,
        run.projectId,
        run.activityId,
        run.status,
        run.createdAt,
        run.kind,
        JSON.stringify({ ...metadata, hasCandidate: false }),
      );
  }

  save(run: ActivityRun): void {
    const { candidate, kind: _kind, ...metadata } = run;
    this.db.exec("BEGIN");
    try {
      const hasCandidate =
        candidate !== null ||
        !!this.db.prepare("SELECT 1 FROM activity_run_candidates WHERE run_id = ?").get(run.runId);
      const result = this.db
        .prepare("UPDATE activity_runs SET status = ?, record_json = ? WHERE run_id = ?")
        .run(run.status, JSON.stringify({ ...metadata, hasCandidate }), run.runId);
      if (result.changes && candidate !== null)
        this.db
          .prepare(
            "INSERT INTO activity_run_candidates (run_id, candidate) VALUES (?, ?) ON CONFLICT(run_id) DO UPDATE SET candidate = excluded.candidate",
          )
          .run(run.runId, candidate);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  get(projectId: string, activityId: string, runId: string): ActivityRun | null {
    const row = this.db
      .prepare(
        "SELECT kind, record_json FROM activity_runs WHERE project_id = ? AND activity_id = ? AND run_id = ?",
      )
      .get(projectId, activityId, runId) as RunRow | undefined;
    if (!row) return null;
    const payload = this.db
      .prepare("SELECT candidate FROM activity_run_candidates WHERE run_id = ?")
      .get(runId) as { candidate: string } | undefined;
    const { hasCandidate: _, ...metadata } = summaryOf(row);
    return { ...metadata, candidate: payload?.candidate ?? null } as ActivityRun;
  }

  summaries(
    projectId: string,
    activityId: string,
    query: { kind?: ActivityRun["kind"]; status?: ActivityRun["status"]; limit?: number } = {},
  ): ActivityRunSummary[] {
    const params: (string | number)[] = [projectId, activityId];
    let sql =
      "SELECT kind, record_json FROM activity_runs WHERE project_id = ? AND activity_id = ?";
    if (query.kind !== undefined) {
      sql += " AND kind = ?";
      params.push(query.kind);
    }
    if (query.status !== undefined) {
      sql += " AND status = ?";
      params.push(query.status);
    }
    sql += " ORDER BY created_at DESC, run_id DESC";
    if (query.limit !== undefined) {
      sql += " LIMIT ?";
      params.push(query.limit);
    }
    return (this.db.prepare(sql).all(...params) as RunRow[]).map(summaryOf);
  }

  running(): ActivityRun[] {
    return (
      this.db
        .prepare("SELECT kind, record_json FROM activity_runs WHERE status = 'running'")
        .all() as RunRow[]
    ).map((row) => ({ ...summaryOf(row), candidate: null }) as ActivityRun);
  }

  hasActive(activityId: string): boolean {
    return !!this.db
      .prepare("SELECT 1 FROM activity_runs WHERE activity_id = ? AND status = 'running'")
      .get(activityId);
  }

  workspace(runId: string): string {
    return path.join(this.config.root, RUNS_DIR, runId);
  }

  projectRunIds(projectId: string): string[] {
    const rows = this.db
      .prepare("SELECT run_id FROM activity_runs WHERE project_id = ?")
      .all(projectId) as Array<{ run_id: string }>;
    return rows.map((row) => row.run_id);
  }

  async removeWorkspaces(runIds: string[]): Promise<void> {
    await Promise.all(
      runIds.map(async (runId) => {
        const folder = this.workspace(runId);
        // An id that names no folder below the runs' own (empty, or with `..`) removes nothing.
        if (!isRunWorkspace(this.config.root, folder)) return;
        // fs.rm unlinks a symlink or junction it meets rather than descending through it.
        await fs.rm(folder, { recursive: true, force: true }).catch((error: unknown) => {
          // Its rows are gone, so nothing will find the folder again but whoever reads this.
          const code = (error as NodeJS.ErrnoException).code ?? String(error);
          this.log.line(
            `[activities] Run ${runId}'s folder was left in place (${code}): ${folder}`,
          );
        });
      }),
    );
  }

  activityOfSession(sessionId: string): string | undefined {
    const row = this.db
      .prepare(
        `SELECT activity_id FROM activity_runs
          WHERE json_extract(record_json, '$.sessionId') = ? LIMIT 1`,
      )
      .get(sessionId) as { activity_id: string } | undefined;
    return row?.activity_id;
  }

  sessionActivities(projectId: string): Map<string, string> {
    const rows = this.db
      .prepare(
        `SELECT json_extract(record_json, '$.sessionId') AS session_id, activity_id
           FROM activity_runs
          WHERE project_id = ? AND json_extract(record_json, '$.sessionId') IS NOT NULL`,
      )
      .all(projectId) as Array<{ session_id: string; activity_id: string }>;
    return new Map(rows.map((row) => [row.session_id, row.activity_id]));
  }
}
