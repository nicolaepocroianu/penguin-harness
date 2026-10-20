import type { Migration } from "../migration.js";

export const usageReportedCost: Migration = {
  name: "2026-09-23-usage-reported-cost",
  // Swap-safe: the column is nullable, so an older writer's inserts simply leave it empty,
  // and an older reader never selects it.
  swapSafe: true,
  up(db) {
    // Cost is computed from the Project's pricing at read time and never stored. A coding
    // agent is the exception: it prices its own work and reports what a turn cost, and no
    // Project pricing exists for it, so that figure is kept on the record. NULL means the
    // runner reported no cost, which is every core Session's record.
    const columns = db.prepare("PRAGMA table_info(usage_records)").all() as { name: string }[];
    if (!columns.some((column) => column.name === "reported_cost_usd"))
      db.exec("ALTER TABLE usage_records ADD COLUMN reported_cost_usd REAL");
  },
  down(db) {
    // Loses only the costs coding agents reported; their tokens stay. SQLite's DROP COLUMN
    // cuts from the last comma before the column, even one inside a `--` comment, so the
    // schema keeps the comment on the column before it free of commas.
    db.exec("ALTER TABLE usage_records DROP COLUMN reported_cost_usd");
  },
};
