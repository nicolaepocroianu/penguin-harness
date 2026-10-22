import type { Migration } from "../migration.js";
import { hasRunKind } from "./run-kind.js";

export const activityAudioRuns: Migration = {
  name: "2026-09-19-activity-audio-runs",
  // Restart prevents old collectors interpreting speech output as specification output.
  // Maintainers retain the migration until schema versions below 14 leave support.
  swapSafe: false,
  up(db) {
    // activity-run-kind-column replaced the marker tables with a column, and a database that
    // has the column needs none: run again there, this would bring back a table it dropped.
    if (hasRunKind(db)) return;
    db.exec(
      "CREATE TABLE IF NOT EXISTS activity_audio_runs (run_id TEXT PRIMARY KEY REFERENCES activity_runs(run_id) ON DELETE CASCADE)",
    );
  },
  down(db) {
    const row = db.prepare("SELECT COUNT(*) AS count FROM activity_audio_runs").get() as {
      count: number;
    };
    if (row.count) throw new Error("Cannot remove audio run storage while speech attempts exist.");
    db.exec("DROP TABLE activity_audio_runs");
  },
};
