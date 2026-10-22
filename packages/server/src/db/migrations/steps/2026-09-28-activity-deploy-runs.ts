import type { Migration } from "../migration.js";

export const activityDeployRuns: Migration = {
  name: "2026-09-28-activity-deploy-runs",
  // Swap-safe: two new tables no older reader or writer knows about, so either build runs
  // against them unchanged.
  swapSafe: true,
  up(db) {
    // An activity's deploy runs and the latest state of each deploy stage. A run's log is a
    // file under PENGUIN_HOME, not a row.
    db.exec(`
      CREATE TABLE IF NOT EXISTS activity_deploy_runs (
        run_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
        activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
        target TEXT NOT NULL CHECK (target IN ('qa', 'prod')),
        status TEXT NOT NULL,
        record_json TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_activity_deploy_runs_activity ON activity_deploy_runs(project_id, activity_id, started_at);
      CREATE TABLE IF NOT EXISTS activity_deploy_stages (
        activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
        stage TEXT NOT NULL,
        status TEXT NOT NULL,
        finished_at TEXT,
        metadata_json TEXT NOT NULL,
        PRIMARY KEY (activity_id, stage)
      );
    `);
  },
  down(db) {
    // Loses the deploy history and stage states; the log files stay on disk, unread.
    db.exec("DROP INDEX IF EXISTS idx_activity_deploy_runs_activity");
    db.exec("DROP TABLE IF EXISTS activity_deploy_stages");
    db.exec("DROP TABLE IF EXISTS activity_deploy_runs");
  },
};
