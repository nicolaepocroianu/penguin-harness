import type { DatabaseSync } from "node:sqlite";

/** Whether `activity_runs` carries the run's kind as a column (activity-run-kind-column, or a fresh database). */
export function hasRunKind(db: DatabaseSync): boolean {
  const columns = db.prepare("PRAGMA table_info(activity_runs)").all() as { name: string }[];
  return columns.some((column) => column.name === "kind");
}
