import { ensureColumn } from "../../database.js";
import type { Migration } from "../migration.js";

export const activityDraftState: Migration = {
  name: "2026-10-24-activity-draft-state",
  // WAF Harness's bookkeeping for a ref's draft (its revision, status, media-plan
  // requirements, module document edits, pinned build), which `wafh.json` in the module held
  // until modules took only Loom's own files (user decision, 2026-10-24). NULL is a ref that
  // has never been saved here: its draft is read from Loom's files as they are, and a
  // `wafh.json` already beside it is read into this column. Swap-safe: a new nullable column.
  swapSafe: true,
  up(db) {
    ensureColumn(db, "activity_drafts", "state", "TEXT");
  },
  // Keep the bookkeeping on rollback; older builds ignore the column.
  down() {},
};
