import type { Migration } from "../migration.js";
import { hasRunKind } from "./run-kind.js";

export const activityModuleRuns: Migration = {
  name: "2026-09-19-activity-module-runs",
  // Older generation services cannot collect module output. Restart before admitting it.
  // Maintainers retain this migration until schemas below 13 leave the supported range.
  swapSafe: false,
  up(db) {
    // activity-run-kind-column replaced the marker tables with a column, and a database that
    // has the column needs none: run again there, this would bring back a table it dropped.
    if (hasRunKind(db)) return;
    db.exec(
      "CREATE TABLE IF NOT EXISTS activity_module_runs (run_id TEXT PRIMARY KEY REFERENCES activity_runs(run_id) ON DELETE CASCADE)",
    );
  },
  down(db) {
    // Refuse to relabel assembly attempts as specification attempts during downgrade.
    const row = db.prepare("SELECT COUNT(*) AS count FROM activity_module_runs").get() as {
      count: number;
    };
    if (row.count)
      throw new Error("Cannot remove module run storage while assembly attempts exist.");
    db.exec("DROP TABLE activity_module_runs");
  },
};
