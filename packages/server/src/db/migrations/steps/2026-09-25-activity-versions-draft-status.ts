import type { Migration } from "../migration.js";

export const activityVersionsDraftStatus: Migration = {
  name: "2026-09-25-activity-versions-draft-status",
  // Swap-safe: the column is nullable, so an older writer's inserts leave it empty and an
  // older reader never selects it.
  swapSafe: true,
  up(db) {
    // The draft's status when the version was kept. It is not content, so it stays out of
    // the version's hash, but a restore needs it: a script edited after its specification
    // leaves the draft "draft", and that must survive a restore. NULL (older rows) means
    // the status is worked out from the specification.
    const columns = db.prepare("PRAGMA table_info(activity_versions)").all() as {
      name: string;
    }[];
    if (!columns.some((column) => column.name === "draft_status"))
      db.exec("ALTER TABLE activity_versions ADD COLUMN draft_status TEXT");
  },
  down(db) {
    // Loses only the kept statuses; a restore then works them out from the specification.
    db.exec("ALTER TABLE activity_versions DROP COLUMN draft_status");
  },
};
