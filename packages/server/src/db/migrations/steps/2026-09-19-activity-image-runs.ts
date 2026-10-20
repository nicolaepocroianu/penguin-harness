import type { Migration } from "../migration.js";
import { hasRunKind } from "./run-kind.js";

export const activityImageRuns: Migration = {
  name: "2026-09-19-activity-image-runs",
  // Old collectors cannot interpret image candidates. Retain until schema <15 leaves support.
  swapSafe: false,
  up(db) {
    // activity-run-kind-column replaced the marker tables with a column, and a database that
    // has the column needs none: run again there, this would bring back a table it dropped.
    if (hasRunKind(db)) return;
    db.exec(
      "CREATE TABLE IF NOT EXISTS activity_image_runs (run_id TEXT PRIMARY KEY REFERENCES activity_runs(run_id) ON DELETE CASCADE)",
    );
  },
  down(db) {
    const row = db.prepare("SELECT COUNT(*) AS count FROM activity_image_runs").get() as {
      count: number;
    };
    if (row.count) throw new Error("Cannot remove image run storage while image attempts exist.");
    db.exec("DROP TABLE activity_image_runs");
  },
};
