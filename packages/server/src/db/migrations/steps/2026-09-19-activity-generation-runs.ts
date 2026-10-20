import type { Migration } from "../migration.js";

export const activityGenerationRuns: Migration = {
  name: "2026-09-19-activity-generation-runs",
  swapSafe: true,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS activity_runs (
        run_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
        activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_activity_runs_activity ON activity_runs(project_id, activity_id, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_runs_active ON activity_runs(activity_id) WHERE status = 'running';
    `);
  },
  // LOSES generation history and candidate copies in SQLite. Isolated run files
  // remain on disk, but are not enough to reconstruct every terminal outcome.
  down(db) {
    db.exec("DROP TABLE IF EXISTS activity_runs");
  },
};
