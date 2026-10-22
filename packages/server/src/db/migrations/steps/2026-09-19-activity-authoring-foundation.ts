import type { Migration } from "../migration.js";

export const activityAuthoringFoundation: Migration = {
  name: "2026-09-19-activity-authoring-foundation",
  swapSafe: true,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS activity_collections (
        project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
        collection_id TEXT NOT NULL,
        path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, collection_id)
      );
      CREATE TABLE IF NOT EXISTS activities (
        id TEXT PRIMARY KEY,
        collection_id TEXT NOT NULL,
        product_code TEXT NOT NULL,
        ref_num INTEGER NOT NULL CHECK (ref_num >= 0),
        title TEXT NOT NULL,
        activity_type TEXT NOT NULL CHECK (activity_type IN ('standard', 'book')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
        UNIQUE (collection_id, product_code, ref_num)
      );
      CREATE INDEX IF NOT EXISTS idx_activities_collection ON activities(collection_id, archived, updated_at);
      CREATE TABLE IF NOT EXISTS activity_drafts (
        draft_id TEXT PRIMARY KEY,
        activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
        base_version_id TEXT,
        content_revision TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft', 'valid', 'invalid')),
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_activity_drafts_activity ON activity_drafts(activity_id, updated_at);
    `);
  },
  down(db) {
    db.exec(
      "DROP TABLE IF EXISTS activity_drafts; DROP TABLE IF EXISTS activities; DROP TABLE IF EXISTS activity_collections;",
    );
  },
};
