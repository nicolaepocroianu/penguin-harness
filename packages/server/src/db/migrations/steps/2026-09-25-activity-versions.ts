import type { Migration } from "../migration.js";

export const activityVersions: Migration = {
  name: "2026-09-25-activity-versions",
  // Swap-safe: a new table no older reader or writer knows about, so either build runs
  // against it unchanged.
  swapSafe: true,
  up(db) {
    // An author's saved versions of an activity. The row says what and when; the content
    // (the version manifest and the media bytes) lives in content-addressed blobs under the
    // activity's own directory, so a file every version shares is stored once.
    db.exec(`
        CREATE TABLE IF NOT EXISTS activity_versions (
        version_id TEXT PRIMARY KEY,
        activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        label TEXT,
        kind TEXT NOT NULL CHECK (kind IN ('manual', 'auto', 'restore', 'deploy')),
        -- Why an automatic version was kept: 'before_restore' or 'before_proposal'.
        reason TEXT,
        -- SHA-256 of the canonical version manifest, which is also the manifest blob's name.
        content_hash TEXT NOT NULL,
        manifest_sha TEXT NOT NULL,
        media_bytes INTEGER NOT NULL,
        module_run_id TEXT,
        source_version_id TEXT,
        author_user_id TEXT,
        deployed_qa_at TEXT,
        deployed_prod_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (activity_id, seq)
        );
        CREATE INDEX IF NOT EXISTS idx_activity_versions_activity ON activity_versions(activity_id, seq);
    `);
  },
  down(db) {
    // Loses the version history. The blobs stay on disk, where nothing reads them.
    db.exec("DROP INDEX IF EXISTS idx_activity_versions_activity");
    db.exec("DROP TABLE IF EXISTS activity_versions");
  },
};
