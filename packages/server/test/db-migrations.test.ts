/**
 * The ordered-migration mechanism, the 0.2.4 → 0.2.7 migration that is its first entry, the
 * 0.2.9 → 0.2.10 drop that is its first restart-only one, the additive column pair that
 * the user profile added to `users`, and the channels migration that is its first table
 * recreation.
 * - Given existing Agent API settings and a key, upgrading adds unset session defaults without
 *   changing the saved exposure, approvals or key; reopening keeps the selected defaults.
 * - Given a machine row from before adoption times, upgrading leaves it without one (the
 *   pre-existing-Sessions rule does not apply to it), and a rollback keeps the times written.
 *
 * Two properties carry everything else: a real 0.2.4 database reaches exactly the shape a
 * fresh one is created with (so a runtime older than the platform pushed onto it becomes
 * usable), and the version stamp commits with the migration (so an interrupted run is never
 * half-applied). The swapPath suite pins the rule that keeps a hot push honest.
 */
import { describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import {
  IrreversibleMigrationError,
  LATEST_VERSION,
  MIGRATIONS,
  RestartRequiredError,
  migrate,
  rollbackTo,
  schemaVersion,
} from "../src/db/migrations.js";
import { SCHEMA_SQL } from "../src/db/schema.js";
import { openDatabase } from "../src/db/database.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sqlite = process.getBuiltinModule("node:sqlite");

/** Upstream's migrations (its 10-19), which this fork runs after its own as 26-35. */
const AFTER_OUTCOMES = MIGRATIONS.filter((m) => m.version > 25).map((m) => m.name);

/**
 * The goal_state table as every release from 0.1.3 to 0.2.9 declared it (frozen: the live
 * schema no longer has it, and the migration that drops it must not learn a new shape).
 */
const GOAL_STATE_DDL = `
  CREATE TABLE goal_state (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL,
    project_id  TEXT NOT NULL,
    agent_id    TEXT NOT NULL,
    objective   TEXT NOT NULL,
    status      TEXT NOT NULL,
    budget      INTEGER NOT NULL,
    used        INTEGER NOT NULL DEFAULT 0,
    rounds      INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
  CREATE INDEX idx_goal_session ON goal_state(session_id);
`;

/** Migration 13's table and index: a database stamped before it had neither. */
function dropBrowserExtensions(db: DatabaseSync): void {
  db.exec("DROP INDEX IF EXISTS idx_browser_extensions_user");
  db.exec("DROP TABLE IF EXISTS browser_extensions");
}

/** Migration 14's two tables and index: a database stamped before it had none of them. */
function dropAgentApi(db: DatabaseSync): void {
  db.exec("DROP INDEX IF EXISTS idx_agent_api_keys_agent");
  db.exec("DROP TABLE IF EXISTS agent_api_keys");
  db.exec("DROP TABLE IF EXISTS agent_api");
}

/** Migration 15's table: a database stamped before it had none. */
function dropMessagingConversations(db: DatabaseSync): void {
  db.exec("DROP TABLE IF EXISTS messaging_conversations");
}

/** Every company-mode table the migrations add: a database from before them had none. */
function dropCompanyModeTables(db: DatabaseSync): void {
  for (const table of [
    "org_sessions",
    "org_ticket_sessions",
    "org_calendar_state",
    "org_ticket_state",
    "org_channel_state",
    "org_channel_reads",
    "org_budget_state",
    "org_desk_notices",
  ]) {
    db.exec(`DROP TABLE IF EXISTS ${table}`);
  }
}

/**
 * The v0.2.4 schema, as a frozen excerpt: today's declaration minus exactly what 0.2.4
 * lacked, plus the one table it had that today's declaration dropped. Derived from
 * SCHEMA_SQL, not by hand-copying 15 tables that would fork from reality.
 */
function open024(): DatabaseSync {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  dropReportedCost(db);
  dropProductTags(db);
  dropActivityVersions(db);
  dropDeployRuns(db);
  db.exec("DROP TABLE IF EXISTS model_promotions");
  db.exec(
    "DROP TABLE IF EXISTS activity_versions; DROP TABLE IF EXISTS activity_media_text_runs; DROP TABLE IF EXISTS activity_image_runs; DROP TABLE IF EXISTS activity_audio_runs; DROP TABLE IF EXISTS activity_module_runs; DROP TABLE IF EXISTS activity_run_candidates; DROP TABLE IF EXISTS activity_runs; DROP TABLE IF EXISTS activity_drafts; DROP TABLE IF EXISTS activities; DROP TABLE IF EXISTS activity_product_tags; DROP TABLE IF EXISTS activity_products; DROP TABLE IF EXISTS activity_collections;",
  );
  dropCompanyModeTables(db);
  db.exec("DROP TABLE messaging_bindings");
  db.exec("DROP INDEX IF EXISTS idx_auth_sessions_expires");
  db.exec("DROP INDEX IF EXISTS idx_auth_sessions_user");
  // No account had a profile before migration 5: the current declaration's two columns
  // must come off, or a round trip through migration 5's down would land on a narrower
  // `users` than this fixture and read as a rollback that lost something.
  dropProfileColumns(db);
  db.exec(GOAL_STATE_DDL);
  return db;
}

/**
 * The two chat tables as migration 5 declared them (frozen: company mode's chat became
 * channels in migration 6 — renamed tables, `channel_id` in the primary keys — and the
 * migration that recreates them must not learn a new shape).
 */
const PRE_CHANNEL_CHAT_DDL = `
  DROP TABLE IF EXISTS org_channel_state;
  DROP TABLE IF EXISTS org_channel_reads;
  CREATE TABLE org_chat_state (
    project_id   TEXT NOT NULL,
    org_id       TEXT NOT NULL,
    date         TEXT NOT NULL,
    offset_bytes INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (project_id, org_id, date)
  );
  CREATE TABLE org_chat_reads (
    project_id   TEXT NOT NULL,
    org_id       TEXT NOT NULL,
    user_id      TEXT NOT NULL,
    last_read_id TEXT NOT NULL,
    PRIMARY KEY (project_id, org_id, user_id)
  );
`;

/** A database stamped at migration 5: company mode's caches, before chat became channels. */
function open6(): DatabaseSync {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  dropReportedCost(db);
  dropProductTags(db);
  dropActivityVersions(db);
  dropDeployRuns(db);
  db.exec("DROP TABLE IF EXISTS model_promotions");
  db.exec(
    "DROP TABLE IF EXISTS activity_versions; DROP TABLE IF EXISTS activity_media_text_runs; DROP TABLE IF EXISTS activity_image_runs; DROP TABLE IF EXISTS activity_audio_runs; DROP TABLE IF EXISTS activity_module_runs; DROP TABLE IF EXISTS activity_run_candidates; DROP TABLE IF EXISTS activity_runs; DROP TABLE IF EXISTS activity_drafts; DROP TABLE IF EXISTS activities; DROP TABLE IF EXISTS activity_product_tags; DROP TABLE IF EXISTS activity_products; DROP TABLE IF EXISTS activity_collections;",
  );
  db.exec(PRE_CHANNEL_CHAT_DDL);
  // SCHEMA_SQL declares the CURRENT shape; migration 8's queue came after 6.
  db.exec("DROP TABLE IF EXISTS org_desk_notices");
  db.exec("PRAGMA user_version = 6");
  return db;
}

/** A database stamped at migration 6: channels, and no desk-notice queue yet. */
function open7(): DatabaseSync {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  dropReportedCost(db);
  dropProductTags(db);
  dropActivityVersions(db);
  dropDeployRuns(db);
  db.exec("DROP TABLE IF EXISTS org_desk_notices");
  db.exec("DROP TABLE IF EXISTS model_promotions");
  db.exec(
    "DROP TABLE IF EXISTS activity_versions; DROP TABLE IF EXISTS activity_media_text_runs; DROP TABLE IF EXISTS activity_image_runs; DROP TABLE IF EXISTS activity_audio_runs; DROP TABLE IF EXISTS activity_module_runs; DROP TABLE IF EXISTS activity_run_candidates; DROP TABLE IF EXISTS activity_runs; DROP TABLE IF EXISTS activity_drafts; DROP TABLE IF EXISTS activities; DROP TABLE IF EXISTS activity_product_tags; DROP TABLE IF EXISTS activity_products; DROP TABLE IF EXISTS activity_collections;",
  );
  db.exec("PRAGMA user_version = 7");
  return db;
}

/** A database stamped at migration 8: desk notices exist, but the promotions table does not. */
function open8(): DatabaseSync {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  dropReportedCost(db);
  dropProductTags(db);
  dropActivityVersions(db);
  dropDeployRuns(db);
  db.exec("DROP TABLE IF EXISTS model_promotions");
  db.exec(
    "DROP TABLE IF EXISTS activity_versions; DROP TABLE IF EXISTS activity_media_text_runs; DROP TABLE IF EXISTS activity_image_runs; DROP TABLE IF EXISTS activity_audio_runs; DROP TABLE IF EXISTS activity_module_runs; DROP TABLE IF EXISTS activity_run_candidates; DROP TABLE IF EXISTS activity_runs; DROP TABLE IF EXISTS activity_drafts; DROP TABLE IF EXISTS activities; DROP TABLE IF EXISTS activity_product_tags; DROP TABLE IF EXISTS activity_products; DROP TABLE IF EXISTS activity_collections;",
  );
  db.exec("PRAGMA user_version = 8");
  return db;
}

/** A database stamped at migration 25: every activity table, but no provider auth refresh tokens. */
function open25(): DatabaseSync {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  dropAfterOutcomes(db);
  db.exec("PRAGMA user_version = 25");
  return db;
}

/** A 0.2.9 database: everything 0.2.4 had plus what versions 1 and 2 added, and still goal_state. */
function open029(): DatabaseSync {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  dropReportedCost(db);
  dropProductTags(db);
  dropActivityVersions(db);
  dropDeployRuns(db);
  db.exec("DROP TABLE IF EXISTS model_promotions");
  db.exec(
    "DROP TABLE IF EXISTS activity_versions; DROP TABLE IF EXISTS activity_media_text_runs; DROP TABLE IF EXISTS activity_image_runs; DROP TABLE IF EXISTS activity_audio_runs; DROP TABLE IF EXISTS activity_module_runs; DROP TABLE IF EXISTS activity_run_candidates; DROP TABLE IF EXISTS activity_runs; DROP TABLE IF EXISTS activity_drafts; DROP TABLE IF EXISTS activities; DROP TABLE IF EXISTS activity_product_tags; DROP TABLE IF EXISTS activity_products; DROP TABLE IF EXISTS activity_collections;",
  );
  dropCompanyModeTables(db);
  db.exec(GOAL_STATE_DDL);
  // SCHEMA_SQL declares the CURRENT shape, and a 0.2.9 database has no machines tables —
  // migration 4 is what adds them — and no profile columns, which migration 5 adds. Without
  // both the fixture is a database no release made.
  db.exec("DROP TABLE machine_project; DROP TABLE machines; DROP TABLE machine;");
  dropProfileColumns(db);
  db.exec("PRAGMA user_version = 2");
  return db;
}

/**
 * A database from before the user profile: today's declaration minus exactly the two columns
 * migration 5 adds, stamped at the version before it. Derived from SCHEMA_SQL for the reason
 * open024 is — a hand-copied `users` table would fork from reality.
 */
function openPreProfile(): DatabaseSync {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  dropReportedCost(db);
  dropProductTags(db);
  dropActivityVersions(db);
  dropDeployRuns(db);
  db.exec("DROP TABLE IF EXISTS model_promotions");
  db.exec(
    "DROP TABLE IF EXISTS activity_versions; DROP TABLE IF EXISTS activity_media_text_runs; DROP TABLE IF EXISTS activity_image_runs; DROP TABLE IF EXISTS activity_audio_runs; DROP TABLE IF EXISTS activity_module_runs; DROP TABLE IF EXISTS activity_run_candidates; DROP TABLE IF EXISTS activity_runs; DROP TABLE IF EXISTS activity_drafts; DROP TABLE IF EXISTS activities; DROP TABLE IF EXISTS activity_product_tags; DROP TABLE IF EXISTS activity_products; DROP TABLE IF EXISTS activity_collections;",
  );
  dropProfileColumns(db);
  // Version 4 predates company mode as well: its three migrations (6–8) come after the
  // profile's, so a database at 4 has none of their tables.
  dropCompanyTables(db);
  db.exec("PRAGMA user_version = 4");
  return db;
}

/** Takes everything migrations 6–8 create off a database built from the current declaration. */
function dropCompanyTables(db: DatabaseSync): void {
  db.exec(`
    DROP INDEX IF EXISTS idx_org_desk_notices_agent;
    DROP INDEX IF EXISTS idx_org_ticket_sessions_session;
    DROP INDEX IF EXISTS idx_org_sessions_org;
    DROP TABLE IF EXISTS org_desk_notices;
    DROP TABLE IF EXISTS org_budget_state;
    DROP TABLE IF EXISTS org_channel_reads;
    DROP TABLE IF EXISTS org_channel_state;
    DROP TABLE IF EXISTS org_ticket_state;
    DROP TABLE IF EXISTS org_calendar_state;
    DROP TABLE IF EXISTS org_ticket_sessions;
    DROP TABLE IF EXISTS org_sessions;
  `);
}

/** Takes migration 5's two columns off a database built from the current declaration. */
function dropProfileColumns(db: DatabaseSync): void {
  db.exec("ALTER TABLE users DROP COLUMN avatar");
  db.exec("ALTER TABLE users DROP COLUMN display_name");
}

/**
 * Migration 19's column, which every database stamped before it lacks: SCHEMA_SQL declares
 * the current `usage_records`, so a fixture for an older version takes it off again.
 */
function dropReportedCost(db: DatabaseSync): void {
  db.exec("ALTER TABLE usage_records DROP COLUMN reported_cost_usd");
}

/**
 * Migration 20's table, which every database stamped before it lacks: SCHEMA_SQL declares
 * it, so a fixture for an older version takes it off again.
 */
function dropProductTags(db: DatabaseSync): void {
  db.exec("DROP TABLE IF EXISTS activity_product_tags");
}

/** Migration 21's table, which every database stamped before it lacks. */
function dropActivityVersions(db: DatabaseSync): void {
  db.exec("DROP TABLE IF EXISTS activity_versions");
}

/** Migration 23's tables, which every database stamped before it lacks. */
function dropDeployRuns(db: DatabaseSync): void {
  db.exec("DROP TABLE IF EXISTS activity_deploy_stages");
  db.exec("DROP TABLE IF EXISTS activity_deploy_runs");
  // Anything older than the deploy runs is older than the stage history too.
  dropPipelines(db);
}

/** The "Run all stages" history migration 24 adds, gone, for a database from before it. */
function dropPipelines(db: DatabaseSync): void {
  db.exec("DROP TABLE IF EXISTS activity_pipelines");
  // Anything older than the stage history is older than the outcome ledger too.
  dropOutcomes(db);
}

/** The outcome ledger migration 25 adds, gone, for a database from before it. */
function dropOutcomes(db: DatabaseSync): void {
  db.exec(`
    DROP TABLE IF EXISTS activity_draft_parts;
    DROP TABLE IF EXISTS activity_outcome_facts;
    DROP TABLE IF EXISTS activity_run_outcomes;
    DROP TABLE IF EXISTS activity_outcome_recipes;
  `);
  // Anything older than the outcome ledger is older than the tables 26-35 add too.
  dropAfterOutcomes(db);
}

/** The tables migrations 26-35 add (upstream's 10-19), gone, for a database from before them. */
function dropAfterOutcomes(db: DatabaseSync): void {
  db.exec("DROP TABLE IF EXISTS model_provider_auth_tokens");
  dropBrowserExtensions(db);
  dropAgentApi(db);
  dropMessagingConversations(db);
}

/** Column names of `users`, for the two cases that are about columns rather than whole shapes. */
function userColumns(db: DatabaseSync): string[] {
  const rows = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  return rows.map((r) => r.name);
}

/** Runs `fn` with the restart-only migration taken off the list, so a swap-path case can see swap-safe ones apply. */
function withoutRestartOnly<T>(fn: () => T): T {
  const list = MIGRATIONS as unknown as (typeof MIGRATIONS)[number][];
  const original = [...list];
  list.splice(0, list.length, ...original.filter((migration) => migration.swapSafe));
  try {
    return fn();
  } finally {
    // Back where it was: appending would reorder the list once later migrations exist.
    list.splice(0, list.length, ...original);
  }
}

/**
 * Every schema object, in a form two databases can be compared by — columns keyed by NAME,
 * with ordinal position (`cid`) excluded.
 *
 * Column ORDER is deliberately not compared. `ALTER TABLE ADD COLUMN` appends, while a
 * fresh database gets the column wherever SCHEMA_SQL declares it, so a migrated database
 * and a freshly created one hold the same columns in a different order — and always have:
 * openDatabase's own ensureColumn list has appended columns to released databases since
 * long before migrations existed. Making the orders match would mean rebuilding the table,
 * which is not additive and would take the rollback guarantee with it. What order actually
 * costs is the column order of `SELECT *`, and every read here maps rows by name.
 *
 * Index column order IS compared: for a composite index it is the index.
 */
function shape(db: DatabaseSync): string {
  const objs = db
    .prepare(
      "SELECT type, name, tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )
    .all() as { type: string; name: string; tbl_name: string }[];
  const dropCid = (rows: unknown[]): Record<string, unknown>[] =>
    rows.map((r) => {
      const { cid: _cid, ...rest } = r as Record<string, unknown>;
      return rest;
    });
  return JSON.stringify(
    objs.map((o) => ({
      ...o,
      detail:
        o.type === "table"
          ? dropCid(db.prepare(`PRAGMA table_info(${o.name})`).all()).sort((a, b) =>
              String(a.name) < String(b.name) ? -1 : String(a.name) > String(b.name) ? 1 : 0,
            )
          : dropCid(db.prepare(`PRAGMA index_info(${o.name})`).all()),
      unique:
        o.type === "index"
          ? (
              db.prepare(`PRAGMA index_list(${o.tbl_name})`).all() as {
                name: string;
                unique: number;
              }[]
            ).find((i) => i.name === o.name)?.unique
          : undefined,
    })),
  );
}

describe("migration mechanism", () => {
  it("versions are contiguous from 1, so a stamp names an unambiguous state", () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(MIGRATIONS.map((_, i) => i + 1));
    expect(LATEST_VERSION).toBe(MIGRATIONS.length);
  });

  it("stamps the database with how far it has come", () => {
    const db = open024();
    try {
      expect(schemaVersion(db)).toBe(0);
      const r = migrate(db);
      expect(r.from).toBe(0);
      expect(r.to).toBe(LATEST_VERSION);
      expect(r.applied).toEqual(MIGRATIONS.map((m) => m.name));
      expect(schemaVersion(db)).toBe(LATEST_VERSION);
    } finally {
      db.close();
    }
  });

  it("runs once: an already-current database does no work", () => {
    const db = open024();
    try {
      migrate(db);
      const before = shape(db);
      const again = migrate(db);
      expect(again.applied).toEqual([]);
      expect(again.from).toBe(LATEST_VERSION);
      expect(shape(db)).toBe(before);
    } finally {
      db.close();
    }
  });

  it("a failing migration leaves the version untouched, never half-applied", () => {
    const db = open024();
    try {
      const boom = {
        version: LATEST_VERSION + 1,
        name: "explodes",
        swapSafe: true,
        up(d: DatabaseSync) {
          d.exec("CREATE TABLE scratch_marker (x TEXT)");
          throw new Error("boom");
        },
      };
      migrate(db);
      const at = schemaVersion(db);
      const shapeBefore = shape(db);
      (MIGRATIONS as unknown as (typeof boom)[]).push(boom);
      try {
        expect(() => migrate(db)).toThrow(/explodes.*failed/s);
        expect(schemaVersion(db)).toBe(at);
        // The table its `up` created is gone with the rolled-back transaction.
        expect(shape(db)).toBe(shapeBefore);
      } finally {
        (MIGRATIONS as unknown as (typeof boom)[]).pop();
      }
    } finally {
      db.close();
    }
  });
});

describe("the swap path refuses what a rollback could not survive", () => {
  it("applies swap-safe migrations while a pushed platform boots", () => {
    const db = open024();
    try {
      const swapSafe = MIGRATIONS.filter((m) => m.swapSafe).map((m) => m.name);
      expect(withoutRestartOnly(() => migrate(db, { swapPath: true }).applied)).toEqual(swapSafe);
    } finally {
      db.close();
    }
  });

  it("refuses a restart-only migration whole, applying nothing — drop-goal-state is the first", () => {
    const db = open024();
    try {
      const before = shape(db);
      expect(() => migrate(db, { swapPath: true })).toThrow(RestartRequiredError);
      // Not even the swap-safe migrations ahead of it ran: the push is refused whole.
      expect(shape(db)).toBe(before);
      expect(schemaVersion(db)).toBe(0);
      // The runtime's own open, which owns the process, may apply it.
      expect(migrate(db).applied).toEqual(MIGRATIONS.map((m) => m.name));
    } finally {
      db.close();
    }
  });

  it("a database already at the latest version boots on the swap path without a word", () => {
    const db = open024();
    try {
      migrate(db);
      expect(migrate(db, { swapPath: true }).applied).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe("0.2.9 → current: drop-goal-state", () => {
  it("drops the table and its index, and a database that never had them migrates the same", () => {
    const db = open029();
    const fresh = new sqlite.DatabaseSync(":memory:");
    try {
      fresh.exec(SCHEMA_SQL);
      const after029 = MIGRATIONS.filter((m) => m.version > 2).map((m) => m.name);
      expect(migrate(db).applied).toEqual(after029);
      expect(shape(db)).toBe(shape(fresh));
      // IF EXISTS: a database this build created, stamped 2 by an older mechanism, has no
      // goal_state to drop and must not fail on it.
      fresh.exec("PRAGMA user_version = 2");
      expect(migrate(fresh).applied).toEqual(after029);
    } finally {
      db.close();
      fresh.close();
    }
  });

  it("down recreates the 0.2.9 table empty, with its index", () => {
    const db = open029();
    try {
      db.exec(
        "INSERT INTO goal_state (session_id, project_id, agent_id, objective, status, budget, created_at, updated_at)" +
          " VALUES ('s1', 'p1', 'a1', 'ship it', 'complete', -1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
      );
      const before = shape(db);
      migrate(db);
      rollbackTo(db, 2);
      expect(shape(db)).toBe(before);
      expect(db.prepare("SELECT COUNT(*) AS n FROM goal_state").get()).toEqual({ n: 0 });
    } finally {
      db.close();
    }
  });
});

describe("pre-profile → current: user-profile", () => {
  it("adds both columns, and a database that already has them migrates the same", () => {
    const db = openPreProfile();
    const fresh = new sqlite.DatabaseSync(":memory:");
    try {
      fresh.exec(SCHEMA_SQL);
      expect(userColumns(db)).not.toContain("display_name");
      expect(migrate(db).applied).toEqual(
        MIGRATIONS.filter((m) => m.version > 4).map((m) => m.name),
      );
      expect(userColumns(db)).toContain("display_name");
      expect(userColumns(db)).toContain("avatar");
      expect(shape(db)).toBe(shape(fresh));

      // ADOPTION: on a database this build created, the declarative track already added both,
      // so the migration must find its work done, add nothing twice, and stamp anyway.
      fresh.exec("PRAGMA user_version = 4");
      expect(migrate(fresh).applied).toEqual(
        MIGRATIONS.filter((m) => m.version > 4).map((m) => m.name),
      );
      expect(userColumns(fresh).filter((c) => c === "avatar")).toEqual(["avatar"]);
    } finally {
      db.close();
      fresh.close();
    }
  });

  it("down removes both columns, taking every nickname and avatar with them", () => {
    const db = openPreProfile();
    try {
      db.exec(
        "INSERT INTO users (user_id, password_hash, is_admin, created_at) VALUES ('bob', 'h', 0, '2026-01-01T00:00:00Z')",
      );
      const before = shape(db);
      migrate(db);
      db.exec("UPDATE users SET display_name = 'Bob', avatar = 'data:image/png;base64,AAAA'");

      rollbackTo(db, 4);
      expect(shape(db)).toBe(before);
      expect(userColumns(db)).not.toContain("display_name");
      expect(userColumns(db)).not.toContain("avatar");
      // The account itself survives; only what the two columns held is gone.
      expect(db.prepare("SELECT user_id FROM users").all()).toEqual([{ user_id: "bob" }]);
    } finally {
      db.close();
    }
  });
});

describe("migration 6 → current: company-mode-channels", () => {
  it("renames both chat tables and puts channel_id in their primary keys, recreating them empty", () => {
    const db = open6();
    const fresh = new sqlite.DatabaseSync(":memory:");
    try {
      fresh.exec(SCHEMA_SQL);
      db.exec(
        "INSERT INTO org_chat_reads (project_id, org_id, user_id, last_read_id)" +
          " VALUES ('p1', 'acme', 'alice', 'msg-2026-09-01-00-00-00-00000000')",
      );
      expect(shape(db)).not.toBe(shape(fresh));

      expect(migrate(db).applied).toEqual(
        MIGRATIONS.filter((m) => m.version > 6).map((m) => m.name),
      );
      expect(shape(db)).toBe(shape(fresh));
      // Renamed and recreated, not altered: the old tables are gone, nothing is carried
      // over, and a row now names its channel.
      expect(
        db
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'org_chat_reads'")
          .get(),
      ).toBeUndefined();
      expect(db.prepare("SELECT COUNT(*) AS n FROM org_channel_reads").get()).toEqual({ n: 0 });
      db.exec(
        "INSERT INTO org_channel_reads (project_id, org_id, channel_id, user_id, last_read_id)" +
          " VALUES ('p1', 'acme', 'default_channel', 'alice', 'msg-2026-09-01-00-00-00-00000000')",
      );
      expect(db.prepare("SELECT channel_id FROM org_channel_reads").all()).toEqual([
        { channel_id: "default_channel" },
      ]);
    } finally {
      db.close();
      fresh.close();
    }
  });

  it("down puts the old tables and the single-chat shape back, empty", () => {
    const db = open6();
    const at6 = open6();
    try {
      migrate(db);
      rollbackTo(db, 6);
      expect(schemaVersion(db)).toBe(6);
      expect(shape(db)).toBe(shape(at6));
      expect(db.prepare("SELECT COUNT(*) AS n FROM org_chat_state").get()).toEqual({ n: 0 });
    } finally {
      db.close();
      at6.close();
    }
  });
});

describe("migration 7 → current: company-mode-desk-notices", () => {
  it("adds the queue a ticket change is delivered through, writable and indexed", () => {
    const db = open7();
    const fresh = new sqlite.DatabaseSync(":memory:");
    try {
      fresh.exec(SCHEMA_SQL);
      expect(shape(db)).not.toBe(shape(fresh));
      expect(migrate(db).applied).toEqual(
        MIGRATIONS.filter((m) => m.version > 7).map((m) => m.name),
      );
      expect(shape(db)).toBe(shape(fresh));
      db.exec(
        "INSERT INTO org_desk_notices (project_id, org_id, agent_id, ticket_id, change, at)" +
          " VALUES ('p1', 'acme', 'acme_hr', '2026-09-08-site', 'assigned', '2026-09-08T01:00:00Z')",
      );
      // seq is the delivery order, handed out by the table itself.
      expect(db.prepare("SELECT seq FROM org_desk_notices").all()).toEqual([{ seq: 1 }]);
    } finally {
      db.close();
      fresh.close();
    }
  });

  it("down drops the queue with the notices nobody has been told about yet", () => {
    const db = open7();
    const at7 = open7();
    try {
      migrate(db);
      db.exec(
        "INSERT INTO org_desk_notices (project_id, org_id, agent_id, ticket_id, change, at)" +
          " VALUES ('p1', 'acme', 'acme_hr', '2026-09-08-site', 'done', '2026-09-08T01:00:00Z')",
      );
      rollbackTo(db, 7);
      expect(schemaVersion(db)).toBe(7);
      expect(shape(db)).toBe(shape(at7));
    } finally {
      db.close();
      at7.close();
    }
  });
});

describe("migration 8 → current: model-promotions", () => {
  it("creates the promotions table, and its down drops it again", () => {
    const db = open8();
    const promotionsTableExists = () =>
      db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'model_promotions'")
        .get();
    const authTokensTableExists = () =>
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'model_provider_auth_tokens'",
        )
        .get();
    try {
      expect(migrate(db).applied).toEqual(
        MIGRATIONS.filter((m) => m.version > 8).map((m) => m.name),
      );
      expect(schemaVersion(db)).toBe(LATEST_VERSION);
      expect(promotionsTableExists()).toEqual({ "1": 1 });
      expect(authTokensTableExists()).toEqual({ "1": 1 });

      rollbackTo(db, 8);
      expect(schemaVersion(db)).toBe(8);
      expect(promotionsTableExists()).toBeUndefined();
      expect(authTokensTableExists()).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("is safe to create while a pushed platform boots", () => {
    const db = open8();
    try {
      expect(withoutRestartOnly(() => migrate(db, { swapPath: true }).applied)).toEqual(
        MIGRATIONS.filter((m) => m.version > 8 && m.swapSafe).map((m) => m.name),
      );
      expect(schemaVersion(db)).toBe(
        Math.max(...MIGRATIONS.filter((m) => m.swapSafe).map((m) => m.version)),
      );
    } finally {
      db.close();
    }
  });
});

describe("activity candidate storage", () => {
  it("requires restart for speech identity and refuses downgrade while speech attempts exist", () => {
    const db = new sqlite.DatabaseSync(":memory:");
    try {
      db.exec(SCHEMA_SQL);
      // The per-kind tables are gone at head; roll back to the shape that had them.
      db.exec(`PRAGMA user_version = ${LATEST_VERSION}`);
      rollbackTo(db, 13);
      expect(() => migrate(db, { swapPath: true })).toThrow(RestartRequiredError);
      expect(schemaVersion(db)).toBe(13);
      migrate(db);
      db.exec(
        "INSERT INTO users (user_id, password_hash, is_admin, created_at) VALUES ('u', 'h', 0, 'now'); INSERT INTO projects VALUES ('p', 'u', 'now'); INSERT INTO activities (id, collection_id, product_code, ref_num, title, activity_type, created_at, updated_at, archived) VALUES ('a', 'c', 'p', 0, 'Title', 'standard', 'now', 'now', 0)",
      );
      db.exec(
        "INSERT INTO activity_runs (run_id, project_id, activity_id, status, created_at, kind, record_json) VALUES ('run', 'p', 'a', 'succeeded', 'now', 'audio', '{}')",
      );
      expect(() => rollbackTo(db, 13)).toThrow("speech attempts exist");
      expect(schemaVersion(db)).toBe(14);
      db.exec("DELETE FROM activity_audio_runs; DELETE FROM activity_runs");
      rollbackTo(db, 13);
      expect(schemaVersion(db)).toBe(13);
    } finally {
      db.close();
    }
  });
  it("requires restart for image identity and refuses downgrade while image attempts exist", () => {
    const db = new sqlite.DatabaseSync(":memory:");
    try {
      db.exec(SCHEMA_SQL);
      // The per-kind tables are gone at head; roll back to the shape that had them.
      db.exec(`PRAGMA user_version = ${LATEST_VERSION}`);
      rollbackTo(db, 14);
      expect(() => migrate(db, { swapPath: true })).toThrow(RestartRequiredError);
      expect(schemaVersion(db)).toBe(14);
      migrate(db);
      db.exec(
        "INSERT INTO users (user_id, password_hash, is_admin, created_at) VALUES ('u', 'h', 0, 'now'); INSERT INTO projects VALUES ('p', 'u', 'now'); INSERT INTO activities (id, collection_id, product_code, ref_num, title, activity_type, created_at, updated_at, archived) VALUES ('a', 'c', 'p', 0, 'Title', 'standard', 'now', 'now', 0)",
      );
      db.exec(
        "INSERT INTO activity_runs (run_id, project_id, activity_id, status, created_at, kind, record_json) VALUES ('run', 'p', 'a', 'succeeded', 'now', 'image', '{}')",
      );
      expect(() => rollbackTo(db, 14)).toThrow("image attempts exist");
      expect(schemaVersion(db)).toBe(15);
      db.exec("DELETE FROM activity_image_runs; DELETE FROM activity_runs");
      rollbackTo(db, 14);
      expect(schemaVersion(db)).toBe(14);
    } finally {
      db.close();
    }
  });
  it("requires restart for media-text identity and refuses downgrade while attempts exist", () => {
    const db = new sqlite.DatabaseSync(":memory:");
    try {
      db.exec(SCHEMA_SQL);
      // The per-kind tables are gone at head; roll back to the shape that had them.
      db.exec(`PRAGMA user_version = ${LATEST_VERSION}`);
      rollbackTo(db, 15);
      expect(() => migrate(db, { swapPath: true })).toThrow(RestartRequiredError);
      expect(schemaVersion(db)).toBe(15);
      migrate(db);
      db.exec(
        "INSERT INTO users (user_id, password_hash, is_admin, created_at) VALUES ('u', 'h', 0, 'now'); INSERT INTO projects VALUES ('p', 'u', 'now'); INSERT INTO activities (id, collection_id, product_code, ref_num, title, activity_type, created_at, updated_at, archived) VALUES ('a', 'c', 'p', 0, 'Title', 'standard', 'now', 'now', 0)",
      );
      db.exec(
        "INSERT INTO activity_runs (run_id, project_id, activity_id, status, created_at, kind, record_json) VALUES ('run', 'p', 'a', 'succeeded', 'now', 'media-text', '{}')",
      );
      expect(() => rollbackTo(db, 15)).toThrow("media text attempts exist");
      expect(schemaVersion(db)).toBe(16);
      db.exec("DELETE FROM activity_media_text_runs; DELETE FROM activity_runs");
      rollbackTo(db, 15);
      expect(schemaVersion(db)).toBe(15);
    } finally {
      db.close();
    }
  });
  it("adds module run identity without rewriting spec history and refuses a lossy downgrade", () => {
    const db = new sqlite.DatabaseSync(":memory:");
    try {
      db.exec(SCHEMA_SQL);
      // The per-kind tables are gone at head; roll back to the shape that had them.
      db.exec(`PRAGMA user_version = ${LATEST_VERSION}`);
      rollbackTo(db, 12);
      expect(() => migrate(db, { swapPath: true })).toThrow(RestartRequiredError);
      expect(schemaVersion(db)).toBe(12);
      migrate(db);
      db.exec(
        "INSERT INTO users (user_id, password_hash, is_admin, created_at) VALUES ('u', 'h', 0, 'now'); INSERT INTO projects VALUES ('p', 'u', 'now'); INSERT INTO activities (id, collection_id, product_code, ref_num, title, activity_type, created_at, updated_at, archived) VALUES ('a', 'c', 'p', 0, 'Title', 'standard', 'now', 'now', 0)",
      );
      db.exec(
        "INSERT INTO activity_runs (run_id, project_id, activity_id, status, created_at, kind, record_json) VALUES ('run', 'p', 'a', 'succeeded', 'now', 'module', '{}')",
      );
      expect(() => rollbackTo(db, 12)).toThrow("assembly attempts exist");
      expect(schemaVersion(db)).toBe(13);
      expect(db.prepare("SELECT record_json FROM activity_runs").get()).toEqual({
        record_json: "{}",
      });
      db.exec("DELETE FROM activity_module_runs; DELETE FROM activity_runs");
      rollbackTo(db, 12);
      expect(schemaVersion(db)).toBe(12);
    } finally {
      db.close();
    }
  });
  it("moves candidate bytes once, preserves invalid output, and restores it on rollback", () => {
    const db = new sqlite.DatabaseSync(":memory:");
    try {
      db.exec(SCHEMA_SQL);
      dropReportedCost(db);
      dropProductTags(db);
      dropActivityVersions(db);
      dropDeployRuns(db);
      db.exec("DROP TABLE activity_run_candidates; PRAGMA user_version = 11");
      db.exec(
        "INSERT INTO users (user_id, password_hash, is_admin, created_at) VALUES ('u', 'h', 0, 'now'); INSERT INTO projects VALUES ('p', 'u', 'now'); INSERT INTO activities (id, collection_id, product_code, ref_num, title, activity_type, created_at, updated_at, archived) VALUES ('a', 'c', 'p', 0, 'Title', 'standard', 'now', 'now', 0)",
      );
      const records = [
        { runId: "one", candidate: "{invalid 中文 JSON", status: "failed" },
        { runId: "two", candidate: null, status: "cancelled" },
      ];
      for (const record of records)
        db.prepare(
          "INSERT INTO activity_runs (run_id, project_id, activity_id, status, created_at, kind, record_json) VALUES (?, 'p', 'a', ?, 'now', 'spec', ?)",
        ).run(record.runId, record.status, JSON.stringify(record));
      expect(() => migrate(db, { swapPath: true })).toThrow(RestartRequiredError);
      expect(schemaVersion(db)).toBe(11);
      migrate(db);
      expect(db.prepare("SELECT * FROM activity_run_candidates").all()).toEqual([
        { run_id: "one", candidate: records[0]!.candidate },
      ]);
      expect(
        db
          .prepare("SELECT record_json FROM activity_runs ORDER BY run_id")
          .all()
          .map((row) => JSON.parse(row.record_json as string)),
      ).toEqual([
        { runId: "one", status: "failed", hasCandidate: true },
        { runId: "two", status: "cancelled", hasCandidate: false },
      ]);
      expect(migrate(db).applied).toEqual([]);
      rollbackTo(db, 11);
      expect(
        db
          .prepare("SELECT record_json FROM activity_runs ORDER BY run_id")
          .all()
          .map((row) => JSON.parse(row.record_json as string)),
      ).toEqual(records);
    } finally {
      db.close();
    }
  });
});

describe("0.2.4 → current", () => {
  /** The whole point: an older runtime's database becomes what a current build creates. */
  it("brings a 0.2.4 database to the shape a fresh one is created with", () => {
    const old = open024();
    const fresh = new sqlite.DatabaseSync(":memory:");
    try {
      fresh.exec(SCHEMA_SQL);
      expect(shape(old)).not.toBe(shape(fresh));

      migrate(old);

      expect(shape(old)).toBe(shape(fresh));
    } finally {
      old.close();
      fresh.close();
    }
  });

  it("the messaging table it creates is writable, which is what the boot needed", () => {
    const db = open024();
    try {
      migrate(db);
      db.exec(
        "INSERT INTO messaging_bindings (session_id, channel, account_id, config_json, created_at, updated_at)" +
          " VALUES ('s1', 'telegram', 'a1', '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
      );
      expect(db.prepare("SELECT COUNT(*) AS n FROM messaging_bindings").get()).toEqual({ n: 1 });
    } finally {
      db.close();
    }
  });

  it("leaves existing rows alone", () => {
    const db = open024();
    try {
      db.exec(
        "INSERT INTO users (user_id, password_hash, is_admin, created_at) VALUES ('admin', 'h', 1, '2026-01-01T00:00:00Z')",
      );
      migrate(db);
      expect(db.prepare("SELECT user_id FROM users").all()).toEqual([{ user_id: "admin" }]);
    } finally {
      db.close();
    }
  });
});

describe("migration 18 → current: usage-reported-cost", () => {
  function open18(): DatabaseSync {
    const db = new sqlite.DatabaseSync(":memory:");
    db.exec(SCHEMA_SQL);
    dropReportedCost(db);
    dropProductTags(db);
    dropActivityVersions(db);
    dropDeployRuns(db);
    db.exec("PRAGMA user_version = 18");
    return db;
  }
  const usageColumns = (db: DatabaseSync) =>
    (db.prepare("PRAGMA table_info(usage_records)").all() as { name: string }[]).map((c) => c.name);

  it("adds the column, keeping the usage already recorded, and the result is a fresh database", () => {
    const db = open18();
    const fresh = new sqlite.DatabaseSync(":memory:");
    try {
      db.exec(
        "INSERT INTO usage_records (ts, date, project_id, agent_id, session_id, provider, model_id, cache_read, cache_write, output, total)" +
          " VALUES ('2026-09-23T00:00:00Z', '2026-09-23', 'p', 'a', 's', 'openai', 'gpt-5', 1, 2, 3, 6)",
      );
      expect(migrate(db).applied).toEqual([
        "usage-reported-cost",
        "activity-product-tags",
        "activity-versions",
        "activity-versions-draft-status",
        "activity-deploy-runs",
        "activity-pipelines",
        "activity-outcomes",
        ...AFTER_OUTCOMES,
      ]);
      expect(usageColumns(db)).toContain("reported_cost_usd");
      expect(db.prepare("SELECT total, reported_cost_usd FROM usage_records").all()).toEqual([
        { total: 6, reported_cost_usd: null },
      ]);
      fresh.exec(SCHEMA_SQL);
      expect(shape(db)).toBe(shape(fresh));
    } finally {
      db.close();
      fresh.close();
    }
  });

  it("down takes the column off and leaves the tokens", () => {
    const db = open18();
    try {
      const before = shape(db);
      migrate(db);
      db.exec(
        "INSERT INTO usage_records (ts, date, project_id, agent_id, session_id, provider, model_id, cache_read, cache_write, output, total, reported_cost_usd)" +
          " VALUES ('2026-09-23T00:00:00Z', '2026-09-23', 'p', 'a', 's', 'coding-agent', 'codex', 0, 0, 3, 6, 0.25)",
      );
      rollbackTo(db, 18);
      expect(shape(db)).toBe(before);
      expect(db.prepare("SELECT total FROM usage_records").all()).toEqual([{ total: 6 }]);
    } finally {
      db.close();
    }
  });
});

describe("migration 19 → current: activity-product-tags", () => {
  function open19(): DatabaseSync {
    const db = new sqlite.DatabaseSync(":memory:");
    db.exec(SCHEMA_SQL);
    dropProductTags(db);
    dropActivityVersions(db);
    dropDeployRuns(db);
    db.exec("PRAGMA user_version = 19");
    return db;
  }
  const tables = (db: DatabaseSync) =>
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((t) => t.name);

  it("adds the table, and the result is a fresh database", () => {
    const db = open19();
    const fresh = new sqlite.DatabaseSync(":memory:");
    try {
      expect(tables(db)).not.toContain("activity_product_tags");
      expect(migrate(db).applied).toEqual([
        "activity-product-tags",
        "activity-versions",
        "activity-versions-draft-status",
        "activity-deploy-runs",
        "activity-pipelines",
        "activity-outcomes",
        ...AFTER_OUTCOMES,
      ]);
      expect(tables(db)).toContain("activity_product_tags");
      fresh.exec(SCHEMA_SQL);
      expect(tables(fresh)).toContain("activity_product_tags");
      expect(shape(db)).toBe(shape(fresh));
    } finally {
      db.close();
      fresh.close();
    }
  });

  it("is swap-safe, so a pushed platform may apply it", () => {
    const db = open19();
    try {
      expect(migrate(db, { swapPath: true }).applied).toEqual([
        "activity-product-tags",
        "activity-versions",
        "activity-versions-draft-status",
        "activity-deploy-runs",
        "activity-pipelines",
        "activity-outcomes",
        ...AFTER_OUTCOMES,
      ]);
    } finally {
      db.close();
    }
  });

  it("down drops only the tags", () => {
    const db = open19();
    try {
      const before = shape(db);
      migrate(db);
      db.exec(
        "INSERT INTO users (user_id, password_hash, is_admin, created_at) VALUES ('u', 'h', 0, 'now');" +
          "INSERT INTO projects VALUES ('p', 'u', 'now');" +
          "INSERT INTO activity_products VALUES ('prd', 'p', 'c', 'code', 'waf-module-code', 0, 'standard', NULL, 'now', 'now');" +
          "INSERT INTO activity_product_tags VALUES ('prd', 'phonics', 0)",
      );
      rollbackTo(db, 19);
      expect(shape(db)).toBe(before);
      expect(db.prepare("SELECT product_code AS code FROM activity_products").all()).toEqual([
        { code: "code" },
      ]);
    } finally {
      db.close();
    }
  });
});

describe("migration 20 → current: activity-versions", () => {
  function open20(): DatabaseSync {
    const db = new sqlite.DatabaseSync(":memory:");
    db.exec(SCHEMA_SQL);
    dropActivityVersions(db);
    dropDeployRuns(db);
    db.exec("PRAGMA user_version = 20");
    return db;
  }
  const tables = (db: DatabaseSync) =>
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((t) => t.name);

  it("adds the table, and the result is a fresh database", () => {
    const db = open20();
    const fresh = new sqlite.DatabaseSync(":memory:");
    try {
      expect(tables(db)).not.toContain("activity_versions");
      expect(migrate(db).applied).toEqual([
        "activity-versions",
        "activity-versions-draft-status",
        "activity-deploy-runs",
        "activity-pipelines",
        "activity-outcomes",
        ...AFTER_OUTCOMES,
      ]);
      expect(tables(db)).toContain("activity_versions");
      fresh.exec(SCHEMA_SQL);
      expect(shape(db)).toBe(shape(fresh));
    } finally {
      db.close();
      fresh.close();
    }
  });

  it("is swap-safe, so a pushed platform may apply it", () => {
    const db = open20();
    try {
      expect(migrate(db, { swapPath: true }).applied).toEqual([
        "activity-versions",
        "activity-versions-draft-status",
        "activity-deploy-runs",
        "activity-pipelines",
        "activity-outcomes",
        ...AFTER_OUTCOMES,
      ]);
    } finally {
      db.close();
    }
  });

  it("refuses an unknown kind and a repeated number for one activity", () => {
    const db = open20();
    try {
      migrate(db);
      db.exec(
        "INSERT INTO activities (id, collection_id, product_code, ref_num, title, activity_type, created_at, updated_at, archived) VALUES ('a', 'c', 'p', 0, 'Title', 'standard', 'now', 'now', 0)",
      );
      const insert = (seq: number, kind: string) =>
        db
          .prepare(
            "INSERT INTO activity_versions (version_id, activity_id, seq, kind, content_hash, manifest_sha, media_bytes, created_at) VALUES (?, 'a', ?, ?, 'h', 'h', 0, 'now')",
          )
          .run(`v${seq}${kind}`, seq, kind);
      insert(1, "manual");
      expect(() => insert(1, "auto")).toThrow();
      expect(() => insert(2, "nightly")).toThrow();
    } finally {
      db.close();
    }
  });

  it("down drops only the versions", () => {
    const db = open20();
    try {
      const before = shape(db);
      migrate(db);
      db.exec(
        "INSERT INTO activities (id, collection_id, product_code, ref_num, title, activity_type, created_at, updated_at, archived) VALUES ('a', 'c', 'p', 0, 'Title', 'standard', 'now', 'now', 0);" +
          "INSERT INTO activity_versions (version_id, activity_id, seq, kind, content_hash, manifest_sha, media_bytes, created_at) VALUES ('v', 'a', 1, 'manual', 'h', 'h', 0, 'now')",
      );
      rollbackTo(db, 20);
      expect(shape(db)).toBe(before);
      expect(db.prepare("SELECT id FROM activities").all()).toEqual([{ id: "a" }]);
    } finally {
      db.close();
    }
  });
});

describe("migration 21 → current: activity-versions-draft-status", () => {
  const versionColumns = (db: DatabaseSync) =>
    (db.prepare("PRAGMA table_info(activity_versions)").all() as { name: string }[]).map(
      (column) => column.name,
    );
  function open21(): DatabaseSync {
    const db = new sqlite.DatabaseSync(":memory:");
    db.exec(SCHEMA_SQL);
    db.exec("ALTER TABLE activity_versions DROP COLUMN draft_status");
    dropDeployRuns(db);
    db.exec("PRAGMA user_version = 21");
    return db;
  }

  it("adds the column, keeping the versions, and the result is a fresh database", () => {
    const db = open21();
    const fresh = new sqlite.DatabaseSync(":memory:");
    try {
      db.exec(
        "INSERT INTO activities (id, collection_id, product_code, ref_num, title, activity_type, created_at, updated_at, archived) VALUES ('a', 'c', 'p', 0, 'Title', 'standard', 'now', 'now', 0);" +
          "INSERT INTO activity_versions (version_id, activity_id, seq, kind, content_hash, manifest_sha, media_bytes, created_at) VALUES ('v', 'a', 1, 'manual', 'h', 'h', 0, 'now')",
      );
      expect(versionColumns(db)).not.toContain("draft_status");
      expect(migrate(db, { swapPath: true }).applied).toEqual([
        "activity-versions-draft-status",
        "activity-deploy-runs",
        "activity-pipelines",
        "activity-outcomes",
        ...AFTER_OUTCOMES,
      ]);
      expect(db.prepare("SELECT version_id, draft_status FROM activity_versions").all()).toEqual([
        { version_id: "v", draft_status: null },
      ]);
      fresh.exec(SCHEMA_SQL);
      expect(shape(db)).toBe(shape(fresh));
    } finally {
      db.close();
      fresh.close();
    }
  });

  it("down drops only the column", () => {
    const db = open21();
    try {
      const before = shape(db);
      migrate(db);
      rollbackTo(db, 21);
      expect(shape(db)).toBe(before);
    } finally {
      db.close();
    }
  });
});

describe("migration 22 → current: activity-deploy-runs", () => {
  function open22(): DatabaseSync {
    const db = new sqlite.DatabaseSync(":memory:");
    db.exec(SCHEMA_SQL);
    dropDeployRuns(db);
    db.exec("PRAGMA user_version = 22");
    return db;
  }
  const tables = (db: DatabaseSync) =>
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((t) => t.name);
  const seed = (db: DatabaseSync) =>
    db.exec(
      "INSERT INTO activities (id, collection_id, product_code, ref_num, title, activity_type, created_at, updated_at, archived) VALUES ('a', 'c', 'p', 0, 'Title', 'standard', 'now', 'now', 0);",
    );

  it("adds both tables, swap-safe, and the result is a fresh database", () => {
    const db = open22();
    const fresh = new sqlite.DatabaseSync(":memory:");
    try {
      expect(tables(db)).not.toContain("activity_deploy_runs");
      expect(migrate(db, { swapPath: true }).applied).toEqual([
        "activity-deploy-runs",
        "activity-pipelines",
        "activity-outcomes",
        ...AFTER_OUTCOMES,
      ]);
      expect(tables(db)).toContain("activity_deploy_runs");
      expect(tables(db)).toContain("activity_deploy_stages");
      fresh.exec(SCHEMA_SQL);
      expect(shape(db)).toBe(shape(fresh));
    } finally {
      db.close();
      fresh.close();
    }
  });

  it("refuses an unknown target and keeps one state per stage", () => {
    const db = open22();
    try {
      migrate(db);
      seed(db);
      // The rows' own checks are what is under test, not the project they would belong to.
      db.exec("PRAGMA foreign_keys = OFF");
      const run = (id: string, target: string) =>
        db
          .prepare(
            "INSERT INTO activity_deploy_runs (run_id, project_id, activity_id, target, status, record_json, started_at) VALUES (?, 'p', 'a', ?, 'running', '{}', 'now')",
          )
          .run(id, target);
      run("r1", "qa");
      expect(() => run("r2", "staging")).toThrow();
      const stage = () =>
        db
          .prepare(
            "INSERT INTO activity_deploy_stages (activity_id, stage, status, metadata_json) VALUES ('a', 'verify_module', 'done', '{}')",
          )
          .run();
      stage();
      expect(stage).toThrow();
    } finally {
      db.close();
    }
  });

  it("down drops only the deploy tables", () => {
    const db = open22();
    try {
      const before = shape(db);
      migrate(db);
      seed(db);
      rollbackTo(db, 22);
      expect(shape(db)).toBe(before);
      expect(db.prepare("SELECT id FROM activities").all()).toEqual([{ id: "a" }]);
    } finally {
      db.close();
    }
  });
});

describe("migration 23 → current: activity-pipelines", () => {
  function open23(): DatabaseSync {
    const db = new sqlite.DatabaseSync(":memory:");
    db.exec(SCHEMA_SQL);
    dropPipelines(db);
    db.exec("PRAGMA user_version = 23");
    return db;
  }

  it("adds the stage history, swap-safe, and the result is a fresh database", () => {
    const db = open23();
    const fresh = new sqlite.DatabaseSync(":memory:");
    try {
      expect(migrate(db, { swapPath: true }).applied).toEqual([
        "activity-pipelines",
        "activity-outcomes",
        ...AFTER_OUTCOMES,
      ]);
      fresh.exec(SCHEMA_SQL);
      expect(shape(db)).toBe(shape(fresh));
    } finally {
      db.close();
      fresh.close();
    }
  });

  it("down drops only the stage history", () => {
    const db = open23();
    try {
      const before = shape(db);
      migrate(db);
      rollbackTo(db, 23);
      expect(shape(db)).toBe(before);
    } finally {
      db.close();
    }
  });
});

describe("migration 24 → current: activity-outcomes", () => {
  function open24(): DatabaseSync {
    const db = new sqlite.DatabaseSync(":memory:");
    db.exec(SCHEMA_SQL);
    dropOutcomes(db);
    db.exec("PRAGMA user_version = 24");
    return db;
  }
  const seed = (db: DatabaseSync) =>
    db.exec(
      "INSERT INTO users (user_id, password_hash, is_admin, created_at) VALUES ('u', 'h', 0, 'now');" +
        "INSERT INTO projects VALUES ('p', 'u', 'now');" +
        "INSERT INTO activities (id, collection_id, product_code, ref_num, title, activity_type, created_at, updated_at, archived) VALUES ('a', 'c', 'p', 0, 'Title', 'standard', 'now', 'now', 0);" +
        "INSERT INTO activity_runs (run_id, project_id, activity_id, status, created_at, kind, record_json) VALUES ('r', 'p', 'a', 'succeeded', 'now', 'spec', '{}');",
    );
  const ledger = (db: DatabaseSync) =>
    db.exec(
      "INSERT INTO activity_outcome_recipes VALUES ('rcp', '{}', 'now');" +
        "INSERT INTO activity_run_outcomes (run_id, project_id, activity_id, kind, recipe_id, started_at, status, metrics_json) VALUES ('r', 'p', 'a', 'spec', 'rcp', 'now', 'succeeded', '{}');" +
        "INSERT INTO activity_outcome_facts (project_id, activity_id, run_id, fact, at, detail_json) VALUES ('p', 'a', 'r', 'settled', 'now', '{}');" +
        "INSERT INTO activity_outcome_facts (project_id, activity_id, run_id, fact, at, detail_json) VALUES ('p', 'a', NULL, 'pinned', 'now', '{}');" +
        "INSERT INTO activity_draft_parts VALUES ('a', 'script', 'r', 'h', 1, 'now');",
    );
  const count = (db: DatabaseSync, table: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

  it("adds the ledger, swap-safe, and the result is a fresh database", () => {
    const db = open24();
    const fresh = new sqlite.DatabaseSync(":memory:");
    try {
      expect(migrate(db, { swapPath: true }).applied).toEqual([
        "activity-outcomes",
        ...AFTER_OUTCOMES,
      ]);
      fresh.exec(SCHEMA_SQL);
      expect(shape(db)).toBe(shape(fresh));
    } finally {
      db.close();
      fresh.close();
    }
  });

  it("leaves the runs it describes alone, and goes with the activity they belong to", () => {
    const db = open24();
    try {
      seed(db);
      migrate(db);
      expect(db.prepare("SELECT run_id, status FROM activity_runs").all()).toEqual([
        { run_id: "r", status: "succeeded" },
      ]);
      db.exec("PRAGMA foreign_keys = ON");
      ledger(db);
      db.exec("DELETE FROM activities WHERE id = 'a'");
      for (const table of [
        "activity_run_outcomes",
        "activity_outcome_facts",
        "activity_draft_parts",
      ])
        expect(count(db, table)).toBe(0);
      expect(count(db, "activity_outcome_recipes")).toBe(1);
    } finally {
      db.close();
    }
  });

  it("down drops only the ledger", () => {
    const db = open24();
    try {
      const before = shape(db);
      seed(db);
      migrate(db);
      ledger(db);
      rollbackTo(db, 24);
      expect(shape(db)).toBe(before);
      expect(db.prepare("SELECT run_id FROM activity_runs").all()).toEqual([{ run_id: "r" }]);
    } finally {
      db.close();
    }
  });
});

describe("rollbackTo", () => {
  /** Every migration states an undo or states that it has none — never leaves it unsaid. */
  it("every migration declares its down, one way or the other", () => {
    for (const m of MIGRATIONS) {
      expect(m, `${m.name} must declare down (a function or null)`).toHaveProperty("down");
      expect(typeof m.down === "function" || m.down === null).toBe(true);
    }
  });

  it("undoes a migration and moves the stamp back with it", () => {
    const db = open024();
    try {
      migrate(db);
      expect(schemaVersion(db)).toBe(LATEST_VERSION);

      // Back to version 1: everything after it is undone, so the columns migration 2 added are gone.
      const r = rollbackTo(db, 1);
      expect(r.from).toBe(LATEST_VERSION);
      expect(r.to).toBe(1);
      // Newest first, all the way down to 1.
      expect(r.reverted).toEqual(
        MIGRATIONS.filter((m) => m.version > 1)
          .map((m) => m.name)
          .reverse(),
      );
      const cols = (
        db.prepare("PRAGMA table_info(messaging_bindings)").all() as { name: string }[]
      ).map((c) => c.name);
      expect(cols).not.toContain("render_markdown");
      expect(cols).not.toContain("final_reply_only");
      // And what the migrations above 1 created is gone with them; goal_state, which 3
      // dropped, is back.
      const tables = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
          name: string;
        }[]
      ).map((t) => t.name);
      expect(tables).not.toContain("machines");
      expect(tables).not.toContain("machine_project");
      expect(tables).not.toContain("org_channel_reads");
      expect(tables).toContain("goal_state");
    } finally {
      db.close();
    }
  });

  /** The property that makes an undo an undo: up ∘ down ∘ up leaves the same schema as up. */
  it("round-trips: up, down, up again lands on the same shape", () => {
    const db = open024();
    try {
      migrate(db);
      const afterUp = shape(db);

      rollbackTo(db, 0);
      expect(schemaVersion(db)).toBe(0);
      expect(shape(db)).not.toBe(afterUp);

      migrate(db);
      expect(schemaVersion(db)).toBe(LATEST_VERSION);
      expect(shape(db)).toBe(afterUp);
    } finally {
      db.close();
    }
  });

  it("reverts newest first, so a multi-step rollback is ordered", () => {
    const db = open024();
    try {
      migrate(db);
      const r = rollbackTo(db, 0);
      expect(r.reverted).toEqual(
        MIGRATIONS.filter((m) => m.version > 0)
          .map((m) => m.name)
          .reverse(),
      );
      expect(
        db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'messaging_bindings'",
          )
          .get(),
      ).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("refuses whole when anything in range has no down, applying nothing", () => {
    const db = open024();
    try {
      migrate(db);
      const at = schemaVersion(db);
      const before = shape(db);
      const oneWay = {
        version: LATEST_VERSION + 1,
        name: "one-way",
        swapSafe: true,
        up(d: DatabaseSync) {
          d.exec("CREATE TABLE one_way (x TEXT)");
        },
        down: null,
      };
      (MIGRATIONS as unknown as (typeof oneWay)[]).push(oneWay);
      try {
        migrate(db);
        // Rolling back past the irreversible one is refused before anything is undone —
        // including the reversible migrations sitting above it.
        expect(() => rollbackTo(db, 0)).toThrow(IrreversibleMigrationError);
        expect(schemaVersion(db)).toBe(at + 1);
      } finally {
        (MIGRATIONS as unknown as (typeof oneWay)[]).pop();
        // Leave the fixture database as the other cases expect it.
        db.exec("DROP TABLE IF EXISTS one_way");
        db.exec(`PRAGMA user_version = ${at}`);
        expect(shape(db)).toBe(before);
      }
    } finally {
      db.close();
    }
  });

  it("will not roll forward, and rejects a negative target", () => {
    const db = open024();
    try {
      migrate(db);
      expect(() => rollbackTo(db, LATEST_VERSION + 5)).toThrow(/already below/);
      expect(() => rollbackTo(db, -1)).toThrow(/negative/);
    } finally {
      db.close();
    }
  });
});

/**
 * Opening a database that was formed before a migration added a column.
 *
 * `openDatabase` runs SCHEMA_SQL and only then migrates, so every statement in SCHEMA_SQL
 * has to be legal against the OLDEST shape still in the wild — not just the newest.
 * `CREATE TABLE IF NOT EXISTS` silently does nothing to a table that exists, so a new
 * column declared inside one never appears, and an index in SCHEMA_SQL covering that
 * column fails with "no such column" before a single migration has run.
 *
 * The rest of this file builds old databases from SCHEMA_SQL and strips what came later,
 * which is right for testing the migrations but cannot catch this: the tables it builds
 * always have the CURRENT columns. This one rolls a real database back instead, so the
 * table shapes are the ones a released build actually wrote.
 */
describe("opening a database older than the newest columns", () => {
  /** A file database left at `version`, the way a server that stopped upgrading left it. */
  function databaseAt(version: number): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-oldschema-"));
    const file = path.join(dir, "web.db");
    const db = new sqlite.DatabaseSync(file);
    try {
      // A fixture needs no durability: skipping the flush per statement is most of its cost.
      db.exec("PRAGMA synchronous = OFF;");
      db.exec(SCHEMA_SQL);
      migrate(db);
      rollbackTo(db, version);
      expect(schemaVersion(db)).toBe(version);
    } finally {
      db.close();
    }
    return file;
  }

  const columns = (db: DatabaseSync, table: string): string[] =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

  it("opens a database predating the run kind and the product level, and migrates it", () => {
    // Version 16 is what a build from before this work left behind; it has neither
    // activity_runs.kind (17) nor activities.product_id (18).
    const file = databaseAt(16);
    const db = openDatabase(file);
    try {
      expect(schemaVersion(db)).toBe(LATEST_VERSION);
      expect(columns(db, "activity_runs")).toContain("kind");
      expect(columns(db, "activities")).toEqual(
        expect.arrayContaining(["product_id", "display_name", "stable"]),
      );
    } finally {
      db.close();
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  it("creates the indexes over those columns, which SCHEMA_SQL must not", () => {
    const file = databaseAt(16);
    const db = openDatabase(file);
    try {
      const indexes = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as {
          name: string;
        }[]
      ).map((row) => row.name);
      expect(indexes).toContain("idx_activity_runs_kind");
      expect(indexes).toContain("idx_activities_product");
    } finally {
      db.close();
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  // One real database file per migration, opened through the whole chain: it grows with every
  // migration and outgrows the shared per-test limit on a busy Windows machine. SQLite here is
  // synchronous, so the loop hands the event loop back between versions: minutes of work in one
  // stretch starve the test runner's own messages until they time out.
  it("opens every version a migration has ever left behind", { timeout: 180_000 }, async () => {
    // The guard generalises: one index added to SCHEMA_SQL over a migration-added column
    // breaks exactly one of these, and only at the version before that migration.
    for (const version of MIGRATIONS.map((m) => m.version - 1)) {
      await new Promise((resolve) => setImmediate(resolve));
      const file = databaseAt(version);
      let db;
      try {
        db = openDatabase(file);
        expect(schemaVersion(db), `opening a version ${version} database`).toBe(LATEST_VERSION);
      } finally {
        db?.close();
        fs.rmSync(path.dirname(file), { recursive: true, force: true });
      }
    }
  });
});

describe("migration 25 → current: model-provider-auth-tokens", () => {
  it("creates the server-side refresh-token table, writable and rollback-safe", () => {
    const db = open25();
    const tableExists = () =>
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'model_provider_auth_tokens'",
        )
        .get();
    try {
      expect(migrate(db).applied).toEqual([
        "model-provider-auth-tokens",
        "sessions-sandbox",
        "machines-columns",
        "browser-extensions",
        "agent-api",
        "messaging-conversations",
        "sessions-kept-at",
        "agent-api-session-settings",
        "agent-api-concurrency",
        "machines-adopted-at",
      ]);
      expect(schemaVersion(db)).toBe(LATEST_VERSION);
      expect(tableExists()).toEqual({ "1": 1 });
      db.exec(
        "INSERT INTO users (user_id, password_hash, is_admin, created_at)" +
          " VALUES ('owner', 'hash', 1, '2026-09-20T00:00:00.000Z')",
      );
      db.exec(
        "INSERT INTO projects (project_id, owner_user_id, created_at)" +
          " VALUES ('p1', 'owner', '2026-09-20T00:00:00.000Z')",
      );
      db.exec(
        "INSERT INTO model_provider_auth_tokens (project_id, provider, refresh_token, access_token_expires_at, updated_at)" +
          " VALUES ('p1', 'modelscope', 'refresh', '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z')",
      );
      expect(db.prepare("SELECT refresh_token FROM model_provider_auth_tokens").all()).toEqual([
        { refresh_token: "refresh" },
      ]);

      rollbackTo(db, 25);
      expect(schemaVersion(db)).toBe(25);
      expect(tableExists()).toBeUndefined();
    } finally {
      db.close();
    }
  });
});

/** A database stamped at migration 28: everything before the Chrome pairings. */
function open28(): DatabaseSync {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  dropBrowserExtensions(db);
  dropAgentApi(db);
  dropMessagingConversations(db);
  db.exec("PRAGMA user_version = 28");
  return db;
}

describe("migration 28 → current: browser-extensions", () => {
  it("creates the pairings table, which holds one row per token and cascades with its user", () => {
    const db = open28();
    try {
      expect(migrate(db, { swapPath: true }).applied).toEqual([
        "browser-extensions",
        "agent-api",
        "messaging-conversations",
        "sessions-kept-at",
        "agent-api-session-settings",
        "agent-api-concurrency",
        "machines-adopted-at",
      ]);
      expect(schemaVersion(db)).toBe(LATEST_VERSION);
      db.exec("PRAGMA foreign_keys = ON");
      db.exec(
        "INSERT INTO users (user_id, password_hash, is_admin, created_at)" +
          " VALUES ('alice', 'hash', 0, '2026-10-02T00:00:00.000Z')",
      );
      const insert = (id: string, hash: string) =>
        db
          .prepare(
            "INSERT INTO browser_extensions (extension_id, user_id, token_hash, name, version, created_at)" +
              " VALUES (?, 'alice', ?, 'Chrome 130 on Linux', '0.2.13', '2026-10-02T00:00:00.000Z')",
          )
          .run(id, hash);
      insert("e1", "h1");
      // A token hash names one pairing.
      expect(() => insert("e2", "h1")).toThrow(/UNIQUE/);
      db.exec("DELETE FROM users WHERE user_id = 'alice'");
      expect(db.prepare("SELECT COUNT(*) AS n FROM browser_extensions").get()).toEqual({ n: 0 });
    } finally {
      db.close();
    }
  });

  it("down drops the pairings, and a second up recreates the table empty", () => {
    const db = open28();
    const tableExists = () =>
      db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'browser_extensions'")
        .get();
    try {
      migrate(db);
      rollbackTo(db, 28);
      expect(schemaVersion(db)).toBe(28);
      expect(tableExists()).toBeUndefined();
      migrate(db);
      expect(tableExists()).toEqual({ "1": 1 });
    } finally {
      db.close();
    }
  });
});

/** A database stamped at migration 29: everything before the Agent API. */
function open29(): DatabaseSync {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  dropAgentApi(db);
  dropMessagingConversations(db);
  db.exec("PRAGMA user_version = 29");
  return db;
}

describe("migration 29 → current: agent-api", () => {
  it("creates the settings table while a pushed platform boots: one row per Agent, keyed and allow-all unless set", () => {
    const db = open29();
    try {
      expect(migrate(db, { swapPath: true }).applied).toEqual([
        "agent-api",
        "messaging-conversations",
        "sessions-kept-at",
        "agent-api-session-settings",
        "agent-api-concurrency",
        "machines-adopted-at",
      ]);
      expect(schemaVersion(db)).toBe(LATEST_VERSION);
      const enable = () =>
        db
          .prepare(
            "INSERT INTO agent_api (project_id, agent_id, enabled, updated_at)" +
              " VALUES ('p1', 'coder', 1, '2026-10-07T00:00:00.000Z')",
          )
          .run();
      enable();
      expect(db.prepare("SELECT enabled, open, approval_mode FROM agent_api").all()).toEqual([
        { enabled: 1, open: 0, approval_mode: "allow-all" },
      ]);
      // The (project, agent) pair is the key: a second row for the same Agent is refused.
      expect(enable).toThrow(/UNIQUE/);
    } finally {
      db.close();
    }
  });

  it("creates the keys table, which holds one key per token hash and only keys a user created", () => {
    const db = open29();
    try {
      migrate(db);
      db.exec("PRAGMA foreign_keys = ON");
      db.exec(
        "INSERT INTO users (user_id, password_hash, is_admin, created_at)" +
          " VALUES ('alice', 'hash', 0, '2026-10-07T00:00:00.000Z')",
      );
      const insert = (keyId: string, hash: string, createdBy: string) =>
        db
          .prepare(
            "INSERT INTO agent_api_keys (key_id, project_id, agent_id, token_hash, prefix, name, created_by, created_at)" +
              " VALUES (?, 'p1', 'coder', ?, 'penguin_abcdefgh', 'ci', ?, '2026-10-07T00:00:00.000Z')",
          )
          .run(keyId, hash, createdBy);
      insert("k1", "h1", "alice");
      // A token hash names one key, so the lookup by hash is never ambiguous.
      expect(() => insert("k2", "h1", "alice")).toThrow(/UNIQUE/);
      expect(() => insert("k3", "h3", "ghost")).toThrow(/FOREIGN KEY/);
      expect(db.prepare("SELECT key_id, last_used_at FROM agent_api_keys").all()).toEqual([
        { key_id: "k1", last_used_at: null },
      ]);
    } finally {
      db.close();
    }
  });

  it("down drops the settings and every key, and a second up recreates both empty", () => {
    const db = open29();
    const at29 = open29();
    try {
      migrate(db);
      db.exec(
        "INSERT INTO agent_api (project_id, agent_id, enabled, updated_at)" +
          " VALUES ('p1', 'coder', 1, '2026-10-07T00:00:00.000Z')",
      );
      rollbackTo(db, 29);
      expect(schemaVersion(db)).toBe(29);
      expect(shape(db)).toBe(shape(at29));
      migrate(db);
      expect(db.prepare("SELECT COUNT(*) AS n FROM agent_api").get()).toEqual({ n: 0 });
    } finally {
      db.close();
      at29.close();
    }
  });
});

/** A database stamped at migration 30: everything before the stored messaging conversations. */
function open30(): DatabaseSync {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  dropMessagingConversations(db);
  db.exec("PRAGMA user_version = 30");
  return db;
}

describe("migration 30 → current: messaging-conversations", () => {
  it("creates one row per (channel, bot, chat) while a pushed platform boots, and its down drops them", () => {
    const db = open30();
    const at30 = open30();
    try {
      expect(migrate(db, { swapPath: true }).applied).toEqual([
        "messaging-conversations",
        "sessions-kept-at",
        "agent-api-session-settings",
        "agent-api-concurrency",
        "machines-adopted-at",
      ]);
      expect(schemaVersion(db)).toBe(LATEST_VERSION);
      const put = () =>
        db
          .prepare(
            "INSERT INTO messaging_conversations (channel, account_id, chat_id, state_json, updated_at)" +
              " VALUES ('wechat', 'bot_1', 'user_1', '{}', '2026-10-10T00:00:00.000Z')",
          )
          .run();
      put();
      expect(put).toThrow(/UNIQUE/);
      rollbackTo(db, 30);
      expect(shape(db)).toBe(shape(at30));
    } finally {
      db.close();
      at30.close();
    }
  });
});

/** A database stamped at migration 31: Sessions carry no keep-in-sidebar mark yet. */
function open31(): DatabaseSync {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  db.exec("ALTER TABLE sessions DROP COLUMN kept_at");
  db.exec("PRAGMA user_version = 31");
  return db;
}

describe("migration 31 → current: sessions-kept-at", () => {
  const insertSession = (db: DatabaseSync) =>
    db.exec(
      "INSERT INTO sessions (session_id, project_id, agent_id, provider, model_id, workspace, created_at)" +
        " VALUES ('s1', 'p1', 'coder', 'openai', 'gpt', '/w', '2026-10-11T00:00:00.000Z')",
    );

  it("adds the mark while a pushed platform boots, leaving every existing Session unmarked", () => {
    const db = open31();
    try {
      insertSession(db);
      expect(migrate(db, { swapPath: true }).applied).toEqual([
        "sessions-kept-at",
        "agent-api-session-settings",
        "agent-api-concurrency",
        "machines-adopted-at",
      ]);
      expect(schemaVersion(db)).toBe(LATEST_VERSION);
      expect(db.prepare("SELECT session_id, kept_at FROM sessions").all()).toEqual([
        { session_id: "s1", kept_at: null },
      ]);
    } finally {
      db.close();
    }
  });

  it("down keeps the column and the marks in it, so a kept Session stays kept", () => {
    const db = open31();
    try {
      insertSession(db);
      migrate(db);
      db.exec("UPDATE sessions SET kept_at = '2026-10-11T01:00:00.000Z'");
      rollbackTo(db, 31);
      expect(schemaVersion(db)).toBe(31);
      expect(db.prepare("SELECT kept_at FROM sessions").get()).toEqual({
        kept_at: "2026-10-11T01:00:00.000Z",
      });
    } finally {
      db.close();
    }
  });
});

/** A database stamped at migration 34: machine rows carry no adoption time yet. */
function open34(): DatabaseSync {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  db.exec("ALTER TABLE machines DROP COLUMN adopted_at");
  db.exec("PRAGMA user_version = 34");
  return db;
}

describe("migration 34 → current: machines-adopted-at", () => {
  const insertMachine = (db: DatabaseSync) =>
    db.exec(
      "INSERT INTO machines (address, machine_id, version, installed_at) VALUES ('ssh:nas', 'm1', '0.2.16', '2026-10-14T00:00:00.000Z')",
    );

  it("adds the adoption time while a pushed platform boots, leaving a machine adopted before it without one", () => {
    const db = open34();
    try {
      insertMachine(db);
      expect(migrate(db, { swapPath: true }).applied).toEqual(["machines-adopted-at"]);
      expect(db.prepare("SELECT address, adopted_at FROM machines").all()).toEqual([
        { address: "ssh:nas", adopted_at: null },
      ]);
    } finally {
      db.close();
    }
  });

  it("down keeps the column and the times in it", () => {
    const db = open34();
    try {
      insertMachine(db);
      migrate(db);
      db.exec("UPDATE machines SET adopted_at = '2026-10-15T00:00:00.000Z'");
      rollbackTo(db, 34);
      expect(schemaVersion(db)).toBe(34);
      expect(db.prepare("SELECT adopted_at FROM machines").get()).toEqual({
        adopted_at: "2026-10-15T00:00:00.000Z",
      });
    } finally {
      db.close();
    }
  });
});

describe("a machines table from before migration 4", () => {
  /** The machines table as the machines line created it before release: forwards, no session, no platform. */
  const ADOPTED_MACHINES_DDL = `
    CREATE TABLE machines (
      address      TEXT PRIMARY KEY,
      machine_id   TEXT,
      version      TEXT,
      installed_at TEXT,
      forward_port INTEGER,
      forward_pid  INTEGER,
      remote_port  INTEGER
    );
  `;

  it("is adopted by migration 4 as it stands, and gains the columns the row writes at 28", () => {
    // What a data root that ran the machines line before its migration holds: IF NOT EXISTS
    // kept the table, and the first connect failed on the insert naming session_pid.
    const db = open029();
    try {
      db.exec(ADOPTED_MACHINES_DDL);
      db.exec("PRAGMA user_version = 3");
      expect(migrate(db).applied).toEqual(
        MIGRATIONS.filter((m) => m.version > 3).map((m) => m.name),
      );
      const columns = (db.prepare("PRAGMA table_info(machines)").all() as { name: string }[]).map(
        (c) => c.name,
      );
      expect(columns).toEqual(expect.arrayContaining(["session_pid", "platform"]));
      db.prepare(
        "INSERT INTO machines (address, machine_id, version, installed_at, session_pid, remote_port, platform) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run("ssh:nas", null, "9.9.9", "2026-09-04T00:00:00.000Z", 42, 7364, "linux");
      // Idempotent: a table that already has them is left as it is.
      expect(migrate(db).applied).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe("migration 32 → current: Agent API session settings", () => {
  it("preserves exposure, approvals and keys while adding defaults, and keeps later choices on re-open", () => {
    const db = new sqlite.DatabaseSync(":memory:");
    try {
      db.exec(SCHEMA_SQL);
      for (const column of [
        "provider",
        "model_id",
        "thinking_level",
        "workspace",
        "max_concurrent_runs",
      ]) {
        db.exec(`ALTER TABLE agent_api DROP COLUMN ${column}`);
      }
      db.exec(`PRAGMA user_version = 32;
        INSERT INTO users (user_id, password_hash, is_admin, created_at) VALUES ('owner', 'hash', 0, 'now');
        INSERT INTO agent_api VALUES ('p', 'a', 1, 1, 'read-only', 'now');
        INSERT INTO agent_api_keys VALUES ('key', 'p', 'a', 'hash', 'prefix', 'ci', 'owner', 'now', NULL);`);
      migrate(db, { swapPath: true });
      expect(db.prepare("SELECT * FROM agent_api").get()).toMatchObject({
        enabled: 1,
        open: 1,
        approval_mode: "read-only",
        provider: null,
        model_id: null,
        thinking_level: null,
        workspace: null,
        max_concurrent_runs: 4,
      });
      expect(db.prepare("SELECT token_hash FROM agent_api_keys").get()).toEqual({
        token_hash: "hash",
      });
      db.exec(
        "UPDATE agent_api SET provider = 'custom', model_id = 'chosen', thinking_level = 'high', workspace = '/work'",
      );
      migrate(db);
      expect(
        db.prepare("SELECT provider, model_id, thinking_level, workspace FROM agent_api").get(),
      ).toEqual({
        provider: "custom",
        model_id: "chosen",
        thinking_level: "high",
        workspace: "/work",
      });
    } finally {
      db.close();
    }
  });
});

// Given a database that already has session settings, the concurrency upgrade preserves them
// and its key, starts with the old limit, and retains a changed limit across repeated startup.
describe("migration 33 → current: API concurrency", () => {
  it("preserves session settings and keys while adding the concurrency limit", () => {
    const db = new sqlite.DatabaseSync(":memory:");
    try {
      db.exec(SCHEMA_SQL);
      db.exec(`ALTER TABLE agent_api DROP COLUMN max_concurrent_runs;
        PRAGMA user_version = 33;
        INSERT INTO users (user_id, password_hash, is_admin, created_at) VALUES ('owner', 'hash', 0, 'now');
        INSERT INTO agent_api (project_id, agent_id, enabled, open, approval_mode, provider, model_id, thinking_level, workspace, updated_at)
          VALUES ('p', 'a', 1, 1, 'read-only', 'custom', 'chosen', 'high', '/work', 'now');
        INSERT INTO agent_api_keys VALUES ('key', 'p', 'a', 'hash', 'prefix', 'ci', 'owner', 'now', NULL);`);
      migrate(db, { swapPath: true });
      expect(db.prepare("SELECT * FROM agent_api").get()).toMatchObject({
        enabled: 1,
        open: 1,
        approval_mode: "read-only",
        provider: "custom",
        model_id: "chosen",
        thinking_level: "high",
        workspace: "/work",
        max_concurrent_runs: 4,
      });
      expect(db.prepare("SELECT token_hash FROM agent_api_keys").get()).toEqual({
        token_hash: "hash",
      });
      db.exec("UPDATE agent_api SET max_concurrent_runs = 9");
      migrate(db);
      expect(db.prepare("SELECT max_concurrent_runs FROM agent_api").get()).toEqual({
        max_concurrent_runs: 9,
      });
    } finally {
      db.close();
    }
  });
});
