import type { Migration } from "../migration.js";

export const activityRunKindColumn: Migration = {
  name: "2026-09-22-activity-run-kind-column",
  // Restart-only: a running collector derives a run's kind by probing the marker
  // tables this migration drops, and would read every surviving run as a spec run.
  swapSafe: false,
  up(db) {
    // The four marker tables answered one question -- what kind of run is this --
    // with one table per answer, which held for five kinds and does not hold for the
    // dozen the generation pipeline adds. A column answers it once.
    //
    // A fresh database gets the column from schema.ts and then replays every
    // migration, so adding it has to be conditional the way CREATE TABLE IF NOT
    // EXISTS is for the rest of this file.
    const columns = db.prepare("PRAGMA table_info(activity_runs)").all() as { name: string }[];
    if (!columns.some((column) => column.name === "kind"))
      db.exec("ALTER TABLE activity_runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'spec'");
    // Each marker table may already be gone on a fresh database; carrying the runs
    // across only matters where one survives.
    for (const [table, kind] of [
      ["activity_media_text_runs", "media-text"],
      ["activity_image_runs", "image"],
      ["activity_audio_runs", "audio"],
      ["activity_module_runs", "module"],
    ] as const) {
      const present = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table);
      if (!present) continue;
      db.exec(
        `UPDATE activity_runs SET kind = '${kind}' WHERE run_id IN (SELECT run_id FROM ${table});`,
      );
      db.exec(`DROP TABLE ${table};`);
    }
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_activity_runs_kind ON activity_runs(activity_id, kind)",
    );
  },
  down(db) {
    // Reversible only while every run still holds one of the five kinds the marker
    // tables could express; a newer stage kind has nowhere to go and says so rather
    // than being silently demoted to a spec run.
    const stray = db
      .prepare(
        "SELECT DISTINCT kind FROM activity_runs WHERE kind NOT IN ('spec','module','audio','image','media-text')",
      )
      .all() as { kind: string }[];
    if (stray.length)
      throw new Error(
        `Cannot restore per-kind run tables: ${stray
          .map((row) => row.kind)
          .join(", ")} has no table to go back to.`,
      );
    db.exec(`
      CREATE TABLE IF NOT EXISTS activity_module_runs (
        run_id TEXT PRIMARY KEY REFERENCES activity_runs(run_id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS activity_audio_runs (
        run_id TEXT PRIMARY KEY REFERENCES activity_runs(run_id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS activity_image_runs (
        run_id TEXT PRIMARY KEY REFERENCES activity_runs(run_id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS activity_media_text_runs (
        run_id TEXT PRIMARY KEY REFERENCES activity_runs(run_id) ON DELETE CASCADE);
      INSERT INTO activity_module_runs (run_id) SELECT run_id FROM activity_runs WHERE kind = 'module';
      INSERT INTO activity_audio_runs (run_id) SELECT run_id FROM activity_runs WHERE kind = 'audio';
      INSERT INTO activity_image_runs (run_id) SELECT run_id FROM activity_runs WHERE kind = 'image';
      INSERT INTO activity_media_text_runs (run_id) SELECT run_id FROM activity_runs WHERE kind = 'media-text';
      DROP INDEX IF EXISTS idx_activity_runs_kind;
      ALTER TABLE activity_runs DROP COLUMN kind;
    `);
  },
};
