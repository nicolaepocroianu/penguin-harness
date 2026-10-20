import type { Migration } from "../migration.js";

export const activityPipelines: Migration = {
  name: "2026-10-10-activity-pipelines",
  // Swap-safe: a new table no older reader or writer knows about.
  swapSafe: true,
  up(db) {
    // "Run all stages" sequences, kept so the Stages panel shows its history after a restart.
    db.exec(`
      CREATE TABLE IF NOT EXISTS activity_pipelines (
        pipeline_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
        activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        record_json TEXT NOT NULL,
        started_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_activity_pipelines_activity ON activity_pipelines(project_id, activity_id, started_at);
    `);
  },
  down(db) {
    // Loses the sequences' history; their runs stay in the generation history.
    db.exec("DROP INDEX IF EXISTS idx_activity_pipelines_activity");
    db.exec("DROP TABLE IF EXISTS activity_pipelines");
  },
};
