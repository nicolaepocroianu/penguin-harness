import type { Migration } from "../migration.js";

export const activityOutcomes: Migration = {
  name: "2026-10-13-activity-outcomes",
  // Swap-safe: four new tables no older reader or writer knows about.
  swapSafe: true,
  up(db) {
    // The outcome ledger: each activity run's recipe and what became of it, and the digest of
    // each part of a draft with the run it came from. Digests, sizes and numbers, never text.
    db.exec(`
      CREATE TABLE IF NOT EXISTS activity_outcome_recipes (
        recipe_id TEXT PRIMARY KEY,
        recipe_json TEXT NOT NULL,
        first_seen_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS activity_run_outcomes (
        run_id TEXT PRIMARY KEY REFERENCES activity_runs(run_id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
        activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        target TEXT,
        recipe_id TEXT REFERENCES activity_outcome_recipes(recipe_id),
        prompt_sha256 TEXT,
        build TEXT,
        started_at TEXT NOT NULL,
        settled_at TEXT,
        status TEXT NOT NULL,
        accepted_by TEXT,
        accepted_at TEXT,
        metrics_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_activity_run_outcomes_kind ON activity_run_outcomes(kind, started_at);
      CREATE INDEX IF NOT EXISTS idx_activity_run_outcomes_target ON activity_run_outcomes(activity_id, kind, target);
      CREATE TABLE IF NOT EXISTS activity_outcome_facts (
        seq INTEGER PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
        activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
        run_id TEXT REFERENCES activity_runs(run_id) ON DELETE CASCADE,
        fact TEXT NOT NULL,
        at TEXT NOT NULL,
        detail_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_activity_outcome_facts_run ON activity_outcome_facts(run_id, seq);
      CREATE INDEX IF NOT EXISTS idx_activity_outcome_facts_activity ON activity_outcome_facts(activity_id, fact, seq);
      CREATE TABLE IF NOT EXISTS activity_draft_parts (
        activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
        part TEXT NOT NULL,
        run_id TEXT REFERENCES activity_runs(run_id) ON DELETE SET NULL,
        sha256 TEXT NOT NULL,
        size INTEGER NOT NULL,
        at TEXT NOT NULL,
        PRIMARY KEY (activity_id, part)
      );
    `);
  },
  down(db) {
    // Loses every recorded recipe and outcome; the runs, their folders and the drafts stay.
    db.exec("DROP TABLE IF EXISTS activity_draft_parts");
    db.exec("DROP INDEX IF EXISTS idx_activity_outcome_facts_activity");
    db.exec("DROP INDEX IF EXISTS idx_activity_outcome_facts_run");
    db.exec("DROP TABLE IF EXISTS activity_outcome_facts");
    db.exec("DROP INDEX IF EXISTS idx_activity_run_outcomes_target");
    db.exec("DROP INDEX IF EXISTS idx_activity_run_outcomes_kind");
    db.exec("DROP TABLE IF EXISTS activity_run_outcomes");
    db.exec("DROP TABLE IF EXISTS activity_outcome_recipes");
  },
};
