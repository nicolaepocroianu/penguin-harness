import type { Migration } from "../migration.js";

export const activityCandidateStorage: Migration = {
  name: "2026-09-19-activity-candidate-storage",
  // Old writers embed candidate bytes in record_json, so upgrade at a restart boundary.
  // Maintainers retain this one-time conversion and rollback with migration history;
  // retire it only when the minimum supported schema no longer permits version 11.
  swapSafe: false,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS activity_run_candidates (
        run_id TEXT PRIMARY KEY REFERENCES activity_runs(run_id) ON DELETE CASCADE,
        candidate TEXT NOT NULL
      );
      INSERT INTO activity_run_candidates (run_id, candidate)
        SELECT run_id, json_extract(record_json, '$.candidate') FROM activity_runs
        WHERE json_type(record_json, '$.candidate') = 'text'
        ON CONFLICT(run_id) DO UPDATE SET candidate = excluded.candidate;
      UPDATE activity_runs SET record_json = json_set(json_remove(record_json, '$.candidate'),
        '$.hasCandidate', json(CASE WHEN EXISTS(SELECT 1 FROM activity_run_candidates c WHERE c.run_id = activity_runs.run_id) THEN 'true' ELSE 'false' END));
    `);
  },
  down(db) {
    db.exec(`
      UPDATE activity_runs SET record_json = json_set(json_remove(record_json, '$.hasCandidate'),
        '$.candidate', (SELECT candidate FROM activity_run_candidates c WHERE c.run_id = activity_runs.run_id));
      DROP TABLE activity_run_candidates;
    `);
  },
};
