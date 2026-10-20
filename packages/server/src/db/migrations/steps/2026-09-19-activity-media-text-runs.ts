import type { Migration } from "../migration.js";
import { hasRunKind } from "./run-kind.js";

export const activityMediaTextRuns: Migration = {
  name: "2026-09-19-activity-media-text-runs",
  // Restart-only: older collectors do not know how to classify media-text attempts.
  swapSafe: false,
  up(db) {
    // activity-run-kind-column replaced the marker tables with a column, and a database that
    // has the column needs none: run again there, this would bring back a table it dropped.
    if (hasRunKind(db)) return;
    db.exec(
      "CREATE TABLE IF NOT EXISTS activity_media_text_runs (run_id TEXT PRIMARY KEY REFERENCES activity_runs(run_id) ON DELETE CASCADE)",
    );
  },
  down(db) {
    const row = db.prepare("SELECT COUNT(*) AS count FROM activity_media_text_runs").get() as {
      count: number;
    };
    if (row.count)
      throw new Error("Cannot remove media text run storage while media text attempts exist.");
    db.exec("DROP TABLE activity_media_text_runs");
  },
};
