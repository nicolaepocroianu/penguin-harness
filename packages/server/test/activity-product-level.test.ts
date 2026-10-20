/**
 * The product level: refs of one product code share a module, and exactly one of them
 * owns it. Loom keeps this in a directory layout; here it has to hold as data.
 */
import { describe, expect, it } from "vitest";
import sqlite from "node:sqlite";
import { SCHEMA_SQL } from "../src/db/schema.js";
import { MIGRATIONS, appliedMigrations, migrate, rollbackTo } from "../src/db/migrations/index.js";
import { namesThrough, record } from "./db-migrations-fixtures.js";
import { defaultModuleFolder, normalizeModuleFolder } from "../src/activities/domain.js";

function seeded() {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  record(
    db,
    MIGRATIONS.map((m) => m.name),
  );
  db.exec(
    "INSERT INTO users (user_id, password_hash, is_admin, created_at) VALUES ('u', 'h', 0, 'now');" +
      "INSERT INTO projects VALUES ('p', 'u', 'now');" +
      "INSERT INTO activity_collections VALUES ('p', 'c', 'activities/c', 'now', 'now')",
  );
  return db;
}

/** The migration before the product level: rolling back to it leaves refs without a product. */
const BEFORE_PRODUCT_LEVEL = "2026-09-22-activity-run-kind-column";

/** Every declared migration is recorded: nothing is left for an open to apply. */
function upToDate(db: sqlite.DatabaseSync): boolean {
  const applied = new Set(appliedMigrations(db));
  return MIGRATIONS.every((m) => applied.has(m.name));
}

/** Writes a ref the way a pre-product-level build would: no product, no name, no flag. */
function legacyRef(db: sqlite.DatabaseSync, id: string, productCode: string, refNum: number) {
  db.prepare(
    "INSERT INTO activities (id, collection_id, product_code, ref_num, title, activity_type, created_at, updated_at, archived) VALUES (?, 'c', ?, ?, ?, 'standard', ?, ?, 0)",
  ).run(id, productCode, refNum, `${productCode} ${refNum}`, `2026-01-0${refNum}`, "now");
}

describe("module folder naming", () => {
  it("defaults to the product code", () => {
    expect(defaultModuleFolder("sight-words")).toBe("waf-module-sight-words");
    expect(normalizeModuleFolder(undefined, "sight-words")).toBe("waf-module-sight-words");
    expect(normalizeModuleFolder("", "sight-words")).toBe("waf-module-sight-words");
    expect(normalizeModuleFolder("   ", "sight-words")).toBe("waf-module-sight-words");
  });

  it("keeps a chosen folder, since one folder may host several products", () => {
    expect(normalizeModuleFolder("waf-module-shared", "sight-words")).toBe("waf-module-shared");
  });

  it("refuses anything that is not one safe path segment", () => {
    for (const bad of ["../escape", "a/b", "trailing-", ".hidden", "with space"])
      expect(() => normalizeModuleFolder(bad, "code")).toThrow("safe path segment");
  });
});

describe("2026-09-22-activity-product-level: giving existing refs a product", () => {
  it("groups refs by product code and makes the earliest ref canonical", () => {
    const db = seeded();
    try {
      rollbackTo(db, BEFORE_PRODUCT_LEVEL);
      legacyRef(db, "a3", "sight-words", 3);
      legacyRef(db, "a1", "sight-words", 1);
      legacyRef(db, "b7", "letter-hunt", 7);
      migrate(db);
      expect(upToDate(db)).toBe(true);

      const products = db
        .prepare(
          "SELECT product_code AS code, module_folder AS folder, canonical_ref_num AS canonical FROM activity_products ORDER BY product_code",
        )
        .all();
      expect(products).toEqual([
        { code: "letter-hunt", folder: "waf-module-letter-hunt", canonical: 7 },
        { code: "sight-words", folder: "waf-module-sight-words", canonical: 1 },
      ]);

      // Every ref of a code joins the one product, canonical or not.
      const refs = db
        .prepare(
          "SELECT a.id AS id, p.product_code AS code FROM activities a JOIN activity_products p ON p.product_id = a.product_id ORDER BY a.id",
        )
        .all();
      expect(refs).toEqual([
        { id: "a1", code: "sight-words" },
        { id: "a3", code: "sight-words" },
        { id: "b7", code: "letter-hunt" },
      ]);
    } finally {
      db.close();
    }
  });

  it("leaves a ref whose collection is already unreachable rather than inventing a project", () => {
    const db = seeded();
    try {
      rollbackTo(db, BEFORE_PRODUCT_LEVEL);
      db.prepare(
        "INSERT INTO activities (id, collection_id, product_code, ref_num, title, activity_type, created_at, updated_at, archived) VALUES ('orphan', 'gone', 'ghost', 0, 'Ghost', 'standard', 'now', 'now', 0)",
      ).run();
      migrate(db);
      expect(
        db.prepare("SELECT product_id AS productId FROM activities WHERE id = 'orphan'").get(),
      ).toEqual({ productId: null });
      expect(db.prepare("SELECT COUNT(*) AS n FROM activity_products").get()).toEqual({ n: 0 });
    } finally {
      db.close();
    }
  });

  it("carries the canonical ref's type onto the product", () => {
    const db = seeded();
    try {
      rollbackTo(db, BEFORE_PRODUCT_LEVEL);
      db.prepare(
        "INSERT INTO activities (id, collection_id, product_code, ref_num, title, activity_type, created_at, updated_at, archived) VALUES ('book1', 'c', 'reader', 1, 'Reader', 'book', 'now', 'now', 0)",
      ).run();
      migrate(db);
      expect(
        db.prepare("SELECT activity_type AS type, book_mode AS mode FROM activity_products").get(),
      ).toEqual({ type: "book", mode: null });
    } finally {
      db.close();
    }
  });

  it("is idempotent, because a fresh database has the columns before migrations replay", () => {
    const db = seeded();
    try {
      // No rollback: the schema already carries the product level, and migrate must not
      // fail trying to add what is there.
      db.exec("DELETE FROM schema_migrations");
      record(db, namesThrough(BEFORE_PRODUCT_LEVEL));
      expect(() => migrate(db)).not.toThrow();
      expect(upToDate(db)).toBe(true);
    } finally {
      db.close();
    }
  });

  it("rolls back to flat refs, keeping the product code that is the real address", () => {
    const db = seeded();
    try {
      rollbackTo(db, BEFORE_PRODUCT_LEVEL);
      legacyRef(db, "a1", "sight-words", 1);
      migrate(db);
      rollbackTo(db, BEFORE_PRODUCT_LEVEL);
      expect(appliedMigrations(db)).toEqual(namesThrough(BEFORE_PRODUCT_LEVEL));
      const columns = (db.prepare("PRAGMA table_info(activities)").all() as { name: string }[]).map(
        (column) => column.name,
      );
      expect(columns).not.toContain("product_id");
      expect(columns).not.toContain("stable");
      expect(columns).toContain("product_code");
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE name = 'activity_products'").get(),
      ).toBeUndefined();
    } finally {
      db.close();
    }
  });
});
