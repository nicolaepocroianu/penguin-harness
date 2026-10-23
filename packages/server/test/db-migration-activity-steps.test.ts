/**
 * What each of this fork's activity migrations changes, from the database the step before it
 * left: the candidate bytes moved out of the run records, the per-kind marker tables and their
 * restart-only identity, the usage cost column, the product tags, the versions and their draft
 * status, the deploy runs, the stage history and the outcome ledger, and a real database file
 * from before the run kind and the product level opened through `openDatabase`. The ledger
 * itself, and upstream's own steps, are pinned in db-migrations.test.ts and
 * db-migration-steps.test.ts.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../src/db/database.js";
import { MIGRATIONS, appliedMigrations, migrate, rollbackTo } from "../src/db/migrations/index.js";
import { SCHEMA_SQL } from "../src/db/schema.js";
import {
  columns,
  dropBrowserExtensions,
  hasTable,
  namesAfter,
  namesThrough,
  openFresh,
  shape,
  sqlite,
  stampThrough,
} from "./db-migrations-fixtures.js";

const GENERATION_RUNS = "2026-09-19-activity-generation-runs";
const CANDIDATE_STORAGE = "2026-09-19-activity-candidate-storage";
const MODULE_RUNS = "2026-09-19-activity-module-runs";
const AUDIO_RUNS = "2026-09-19-activity-audio-runs";
const IMAGE_RUNS = "2026-09-19-activity-image-runs";
const MEDIA_TEXT_RUNS = "2026-09-19-activity-media-text-runs";
const PRODUCT_LEVEL = "2026-09-22-activity-product-level";
const REPORTED_COST = "2026-09-23-usage-reported-cost";
const PRODUCT_TAGS = "2026-09-25-activity-product-tags";
const VERSIONS = "2026-09-25-activity-versions";
const DRAFT_STATUS = "2026-09-25-activity-versions-draft-status";
const DEPLOY_RUNS = "2026-09-28-activity-deploy-runs";
const PIPELINES = "2026-10-10-activity-pipelines";
const OUTCOMES = "2026-10-13-activity-outcomes";

/**
 * What the fork's later activity steps add, each with how to take it off again, newest first:
 * a root through an earlier step has none of what the steps after it add.
 */
const LATER: readonly [string, (db: DatabaseSync) => void][] = [
  [
    OUTCOMES,
    (db) =>
      db.exec(`
        DROP TABLE IF EXISTS activity_draft_parts;
        DROP TABLE IF EXISTS activity_outcome_facts;
        DROP TABLE IF EXISTS activity_run_outcomes;
        DROP TABLE IF EXISTS activity_outcome_recipes;
      `),
  ],
  [PIPELINES, (db) => db.exec("DROP TABLE IF EXISTS activity_pipelines")],
  [
    DEPLOY_RUNS,
    (db) =>
      db.exec(
        "DROP TABLE IF EXISTS activity_deploy_stages; DROP TABLE IF EXISTS activity_deploy_runs",
      ),
  ],
  [DRAFT_STATUS, (db) => db.exec("ALTER TABLE activity_versions DROP COLUMN draft_status")],
  [VERSIONS, (db) => db.exec("DROP TABLE IF EXISTS activity_versions")],
  [PRODUCT_TAGS, (db) => db.exec("DROP TABLE IF EXISTS activity_product_tags")],
  [REPORTED_COST, (db) => db.exec("ALTER TABLE usage_records DROP COLUMN reported_cost_usd")],
];

/**
 * A root through `name`: a fresh database without the tables and columns the fork's later
 * activity steps add, nor the tables upstream's steps after them add (whose downs drop them),
 * and a ledger recording every migration through `name`.
 */
function openThrough(name: string): DatabaseSync {
  const db = openFresh();
  const through = new Set(namesThrough(name));
  for (const [step, take] of LATER) if (!through.has(step)) take(db);
  db.exec("DROP TABLE IF EXISTS model_provider_auth_tokens");
  dropBrowserExtensions(db);
  stampThrough(db, name);
  return db;
}

/** Every migration declared, recorded or not: a root a build has fully migrated. */
function openHead(): DatabaseSync {
  const db = openFresh();
  stampThrough(db, MIGRATIONS[MIGRATIONS.length - 1]!.name);
  return db;
}

const tables = (db: DatabaseSync) =>
  (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
  ).map((t) => t.name);

const seedActivity = (db: DatabaseSync) =>
  db.exec(
    "INSERT INTO users (user_id, password_hash, is_admin, created_at) VALUES ('u', 'h', 0, 'now'); INSERT INTO projects VALUES ('p', 'u', 'now'); INSERT INTO activities (id, collection_id, product_code, ref_num, title, activity_type, created_at, updated_at, archived) VALUES ('a', 'c', 'p', 0, 'Title', 'standard', 'now', 'now', 0)",
  );

const insertRun = (db: DatabaseSync, kind: string) =>
  db.exec(
    `INSERT INTO activity_runs (run_id, project_id, activity_id, status, created_at, kind, record_json) VALUES ('run', 'p', 'a', 'succeeded', 'now', '${kind}', '{}')`,
  );

describe("the restart-only run identity: 2026-09-19-activity-*-runs", () => {
  /**
   * Each marker table is a contract: a hot push leaves it pending, and a rollback refuses to
   * drop it while it still says what a run was.
   */
  for (const { step, before, table, kind, refusal } of [
    {
      step: MODULE_RUNS,
      before: CANDIDATE_STORAGE,
      table: "activity_module_runs",
      kind: "module",
      refusal: "assembly attempts exist",
    },
    {
      step: AUDIO_RUNS,
      before: MODULE_RUNS,
      table: "activity_audio_runs",
      kind: "audio",
      refusal: "speech attempts exist",
    },
    {
      step: IMAGE_RUNS,
      before: AUDIO_RUNS,
      table: "activity_image_runs",
      kind: "image",
      refusal: "image attempts exist",
    },
    {
      step: MEDIA_TEXT_RUNS,
      before: IMAGE_RUNS,
      table: "activity_media_text_runs",
      kind: "media-text",
      refusal: "media text attempts exist",
    },
  ]) {
    it(`${step}: a hot push leaves it pending, and a rollback refuses while ${kind} runs exist`, () => {
      const db = openHead();
      try {
        // The marker tables are gone at head; roll back to the shape before this one.
        rollbackTo(db, before);
        expect(hasTable(db, table)).toBe(false);
        const pushed = migrate(db, { swapPath: true });
        expect(pushed.deferred).toContain(step);
        expect(hasTable(db, table)).toBe(false);
        migrate(db);
        seedActivity(db);
        insertRun(db, kind);
        expect(() => rollbackTo(db, before)).toThrow(refusal);
        // Everything above it came off; it stays, with the run it names.
        expect(appliedMigrations(db)).toContain(step);
        expect(appliedMigrations(db)).not.toContain("2026-09-22-activity-run-kind-column");
        expect(db.prepare("SELECT record_json FROM activity_runs").get()).toEqual({
          record_json: "{}",
        });
        db.exec(`DELETE FROM ${table}; DELETE FROM activity_runs`);
        rollbackTo(db, before);
        expect(appliedMigrations(db)).toEqual(namesThrough(before));
      } finally {
        db.close();
      }
    });
  }
});

describe(`${GENERATION_RUNS} → current: ${CANDIDATE_STORAGE}`, () => {
  it("moves candidate bytes once, preserves invalid output, and restores it on rollback", () => {
    const db = openFresh();
    try {
      db.exec("DROP TABLE activity_run_candidates");
      stampThrough(db, GENERATION_RUNS);
      seedActivity(db);
      const records = [
        { runId: "one", candidate: "{invalid 中文 JSON", status: "failed" },
        { runId: "two", candidate: null, status: "cancelled" },
      ];
      for (const record of records)
        db.prepare(
          "INSERT INTO activity_runs (run_id, project_id, activity_id, status, created_at, kind, record_json) VALUES (?, 'p', 'a', ?, 'now', 'spec', ?)",
        ).run(record.runId, record.status, JSON.stringify(record));
      // A hot push leaves the conversion for the runtime: older writers still embed the bytes.
      expect(migrate(db, { swapPath: true }).deferred).toContain(CANDIDATE_STORAGE);
      expect(hasTable(db, "activity_run_candidates")).toBe(false);
      migrate(db);
      expect(db.prepare("SELECT * FROM activity_run_candidates").all()).toEqual([
        { run_id: "one", candidate: records[0]!.candidate },
      ]);
      const recordsNow = () =>
        db
          .prepare("SELECT record_json FROM activity_runs ORDER BY run_id")
          .all()
          .map((row) => JSON.parse(row.record_json as string));
      expect(recordsNow()).toEqual([
        { runId: "one", status: "failed", hasCandidate: true },
        { runId: "two", status: "cancelled", hasCandidate: false },
      ]);
      expect(migrate(db).applied).toEqual([]);
      rollbackTo(db, GENERATION_RUNS);
      expect(recordsNow()).toEqual(records);
    } finally {
      db.close();
    }
  });
});

describe(`${PRODUCT_LEVEL} → current: ${REPORTED_COST}`, () => {
  const usageColumns = (db: DatabaseSync) => columns(db, "usage_records");

  it("adds the column, keeping the usage already recorded, and the result is a fresh database", () => {
    const db = openThrough(PRODUCT_LEVEL);
    const fresh = openFresh();
    try {
      db.exec(
        "INSERT INTO usage_records (ts, date, project_id, agent_id, session_id, provider, model_id, cache_read, cache_write, output, total)" +
          " VALUES ('2026-09-23T00:00:00Z', '2026-09-23', 'p', 'a', 's', 'openai', 'gpt-5', 1, 2, 3, 6)",
      );
      expect(migrate(db).applied).toEqual(namesAfter(PRODUCT_LEVEL));
      expect(usageColumns(db)).toContain("reported_cost_usd");
      expect(db.prepare("SELECT total, reported_cost_usd FROM usage_records").all()).toEqual([
        { total: 6, reported_cost_usd: null },
      ]);
      expect(shape(db)).toBe(shape(fresh));
    } finally {
      db.close();
      fresh.close();
    }
  });

  it("down takes the column off and leaves the tokens", () => {
    const db = openThrough(PRODUCT_LEVEL);
    try {
      const before = shape(db);
      migrate(db);
      db.exec(
        "INSERT INTO usage_records (ts, date, project_id, agent_id, session_id, provider, model_id, cache_read, cache_write, output, total, reported_cost_usd)" +
          " VALUES ('2026-09-23T00:00:00Z', '2026-09-23', 'p', 'a', 's', 'coding-agent', 'codex', 0, 0, 3, 6, 0.25)",
      );
      rollbackTo(db, PRODUCT_LEVEL);
      expect(shape(db)).toBe(before);
      expect(db.prepare("SELECT total FROM usage_records").all()).toEqual([{ total: 6 }]);
    } finally {
      db.close();
    }
  });
});

describe(`${REPORTED_COST} → current: ${PRODUCT_TAGS}`, () => {
  it("adds the table, and the result is a fresh database", () => {
    const db = openThrough(REPORTED_COST);
    const fresh = openFresh();
    try {
      expect(tables(db)).not.toContain("activity_product_tags");
      expect(migrate(db).applied).toEqual(namesAfter(REPORTED_COST));
      expect(tables(db)).toContain("activity_product_tags");
      expect(tables(fresh)).toContain("activity_product_tags");
      expect(shape(db)).toBe(shape(fresh));
    } finally {
      db.close();
      fresh.close();
    }
  });

  it("is swap-safe, so a pushed platform may apply it", () => {
    const db = openThrough(REPORTED_COST);
    try {
      expect(migrate(db, { swapPath: true }).applied).toEqual(namesAfter(REPORTED_COST));
    } finally {
      db.close();
    }
  });

  it("down drops only the tags", () => {
    const db = openThrough(REPORTED_COST);
    try {
      const before = shape(db);
      migrate(db);
      db.exec(
        "INSERT INTO users (user_id, password_hash, is_admin, created_at) VALUES ('u', 'h', 0, 'now');" +
          "INSERT INTO projects VALUES ('p', 'u', 'now');" +
          "INSERT INTO activity_products VALUES ('prd', 'p', 'c', 'code', 'waf-module-code', 0, 'standard', NULL, 'now', 'now');" +
          "INSERT INTO activity_product_tags VALUES ('prd', 'phonics', 0)",
      );
      rollbackTo(db, REPORTED_COST);
      expect(shape(db)).toBe(before);
      expect(db.prepare("SELECT product_code AS code FROM activity_products").all()).toEqual([
        { code: "code" },
      ]);
    } finally {
      db.close();
    }
  });
});

describe(`${PRODUCT_TAGS} → current: ${VERSIONS}`, () => {
  it("adds the table, and the result is a fresh database", () => {
    const db = openThrough(PRODUCT_TAGS);
    const fresh = openFresh();
    try {
      expect(tables(db)).not.toContain("activity_versions");
      expect(migrate(db).applied).toEqual(namesAfter(PRODUCT_TAGS));
      expect(tables(db)).toContain("activity_versions");
      expect(shape(db)).toBe(shape(fresh));
    } finally {
      db.close();
      fresh.close();
    }
  });

  it("is swap-safe, so a pushed platform may apply it", () => {
    const db = openThrough(PRODUCT_TAGS);
    try {
      expect(migrate(db, { swapPath: true }).applied).toEqual(namesAfter(PRODUCT_TAGS));
    } finally {
      db.close();
    }
  });

  it("refuses an unknown kind and a repeated number for one activity", () => {
    const db = openThrough(PRODUCT_TAGS);
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
    const db = openThrough(PRODUCT_TAGS);
    try {
      const before = shape(db);
      migrate(db);
      db.exec(
        "INSERT INTO activities (id, collection_id, product_code, ref_num, title, activity_type, created_at, updated_at, archived) VALUES ('a', 'c', 'p', 0, 'Title', 'standard', 'now', 'now', 0);" +
          "INSERT INTO activity_versions (version_id, activity_id, seq, kind, content_hash, manifest_sha, media_bytes, created_at) VALUES ('v', 'a', 1, 'manual', 'h', 'h', 0, 'now')",
      );
      rollbackTo(db, PRODUCT_TAGS);
      expect(shape(db)).toBe(before);
      expect(db.prepare("SELECT id FROM activities").all()).toEqual([{ id: "a" }]);
    } finally {
      db.close();
    }
  });
});

describe(`${VERSIONS} → current: ${DRAFT_STATUS}`, () => {
  const versionColumns = (db: DatabaseSync) => columns(db, "activity_versions");

  it("adds the column, keeping the versions, and the result is a fresh database", () => {
    const db = openThrough(VERSIONS);
    const fresh = openFresh();
    try {
      db.exec(
        "INSERT INTO activities (id, collection_id, product_code, ref_num, title, activity_type, created_at, updated_at, archived) VALUES ('a', 'c', 'p', 0, 'Title', 'standard', 'now', 'now', 0);" +
          "INSERT INTO activity_versions (version_id, activity_id, seq, kind, content_hash, manifest_sha, media_bytes, created_at) VALUES ('v', 'a', 1, 'manual', 'h', 'h', 0, 'now')",
      );
      expect(versionColumns(db)).not.toContain("draft_status");
      expect(migrate(db, { swapPath: true }).applied).toEqual(namesAfter(VERSIONS));
      expect(db.prepare("SELECT version_id, draft_status FROM activity_versions").all()).toEqual([
        { version_id: "v", draft_status: null },
      ]);
      expect(shape(db)).toBe(shape(fresh));
    } finally {
      db.close();
      fresh.close();
    }
  });

  it("down drops only the column", () => {
    const db = openThrough(VERSIONS);
    try {
      const before = shape(db);
      migrate(db);
      rollbackTo(db, VERSIONS);
      expect(shape(db)).toBe(before);
    } finally {
      db.close();
    }
  });
});

describe(`${DRAFT_STATUS} → current: ${DEPLOY_RUNS}`, () => {
  const seed = (db: DatabaseSync) =>
    db.exec(
      "INSERT INTO activities (id, collection_id, product_code, ref_num, title, activity_type, created_at, updated_at, archived) VALUES ('a', 'c', 'p', 0, 'Title', 'standard', 'now', 'now', 0);",
    );

  it("adds both tables, swap-safe, and the result is a fresh database", () => {
    const db = openThrough(DRAFT_STATUS);
    const fresh = openFresh();
    try {
      expect(tables(db)).not.toContain("activity_deploy_runs");
      expect(migrate(db, { swapPath: true }).applied).toEqual(namesAfter(DRAFT_STATUS));
      expect(tables(db)).toContain("activity_deploy_runs");
      expect(tables(db)).toContain("activity_deploy_stages");
      expect(shape(db)).toBe(shape(fresh));
    } finally {
      db.close();
      fresh.close();
    }
  });

  it("refuses an unknown target and keeps one state per stage", () => {
    const db = openThrough(DRAFT_STATUS);
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
    const db = openThrough(DRAFT_STATUS);
    try {
      const before = shape(db);
      migrate(db);
      seed(db);
      rollbackTo(db, DRAFT_STATUS);
      expect(shape(db)).toBe(before);
      expect(db.prepare("SELECT id FROM activities").all()).toEqual([{ id: "a" }]);
    } finally {
      db.close();
    }
  });
});

describe(`${DEPLOY_RUNS} → current: ${PIPELINES}`, () => {
  it("adds the stage history, swap-safe, and the result is a fresh database", () => {
    const db = openThrough(DEPLOY_RUNS);
    const fresh = openFresh();
    try {
      expect(migrate(db, { swapPath: true }).applied).toEqual(namesAfter(DEPLOY_RUNS));
      expect(shape(db)).toBe(shape(fresh));
    } finally {
      db.close();
      fresh.close();
    }
  });

  it("down drops only the stage history", () => {
    const db = openThrough(DEPLOY_RUNS);
    try {
      const before = shape(db);
      migrate(db);
      rollbackTo(db, DEPLOY_RUNS);
      expect(shape(db)).toBe(before);
    } finally {
      db.close();
    }
  });
});

describe(`${PIPELINES} → current: ${OUTCOMES}`, () => {
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
    const db = openThrough(PIPELINES);
    const fresh = openFresh();
    try {
      expect(migrate(db, { swapPath: true }).applied).toEqual(namesAfter(PIPELINES));
      expect(shape(db)).toBe(shape(fresh));
    } finally {
      db.close();
      fresh.close();
    }
  });

  it("leaves the runs it describes alone, and goes with the activity they belong to", () => {
    const db = openThrough(PIPELINES);
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
    const db = openThrough(PIPELINES);
    try {
      const before = shape(db);
      seed(db);
      migrate(db);
      ledger(db);
      rollbackTo(db, PIPELINES);
      expect(shape(db)).toBe(before);
      expect(db.prepare("SELECT run_id FROM activity_runs").all()).toEqual([{ run_id: "r" }]);
    } finally {
      db.close();
    }
  });
});

/**
 * Opening a database that was formed before a migration added a column.
 *
 * `openDatabase` runs SCHEMA_SQL and only then migrates, so every statement in SCHEMA_SQL has to
 * be legal against the OLDEST shape still in the wild. `CREATE TABLE IF NOT EXISTS` does nothing
 * to a table that exists, so an index in SCHEMA_SQL over a column a migration added would fail
 * with "no such column" before a single migration had run. The fixtures above build old shapes
 * from SCHEMA_SQL, which always has the CURRENT columns; this rolls a real database back instead.
 */
describe("opening a database from before the run kind and the product level", () => {
  /** A file database rolled back to `name`, the way a server that stopped upgrading left it. */
  function databaseThrough(name: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wafh-oldschema-"));
    const file = path.join(dir, "web.db");
    const db = new sqlite.DatabaseSync(file);
    try {
      // A fixture needs no durability: skipping the flush per statement is most of its cost.
      db.exec("PRAGMA synchronous = OFF;");
      db.exec(SCHEMA_SQL);
      migrate(db);
      rollbackTo(db, name);
      expect(appliedMigrations(db)).toEqual(namesThrough(name));
    } finally {
      db.close();
    }
    return file;
  }

  it("opens a database predating the run kind and the product level, and migrates it", () => {
    // Through the media-text runs is what a build from before this work left behind: it has
    // neither activity_runs.kind nor activities.product_id.
    const file = databaseThrough(MEDIA_TEXT_RUNS);
    const db = openDatabase(file);
    try {
      expect(new Set(appliedMigrations(db))).toEqual(new Set(MIGRATIONS.map((m) => m.name)));
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
    const file = databaseThrough(MEDIA_TEXT_RUNS);
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
});
