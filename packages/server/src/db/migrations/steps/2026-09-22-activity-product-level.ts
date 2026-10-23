import type { Migration } from "../migration.js";

export const activityProductLevel: Migration = {
  name: "2026-09-22-activity-product-level",
  // Restart-only: an older writer creates activities with no product parent, and the
  // canonical-ref rule three generation stages depend on cannot be answered for them.
  swapSafe: false,
  up(db) {
    // Loom nests refs under a product that owns the module code, with one ref canonical.
    // WAF Harness had (productCode, refNum) flattened into one row and so could not say which
    // ref was canonical. This gives the product somewhere to live.
    db.exec(`
      CREATE TABLE IF NOT EXISTS activity_products (
        product_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
        collection_id TEXT NOT NULL,
        product_code TEXT NOT NULL,
        module_folder TEXT NOT NULL,
        canonical_ref_num INTEGER,
        activity_type TEXT NOT NULL CHECK (activity_type IN ('standard', 'book')),
        book_mode TEXT CHECK (book_mode IN ('decodable', 'readAlong')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (collection_id, product_code)
      );
      CREATE INDEX IF NOT EXISTS idx_activity_products_collection
        ON activity_products(collection_id, product_code);
    `);
    const columns = db.prepare("PRAGMA table_info(activities)").all() as { name: string }[];
    const has = (name: string) => columns.some((column) => column.name === name);
    if (!has("product_id"))
      db.exec(
        "ALTER TABLE activities ADD COLUMN product_id TEXT REFERENCES activity_products(product_id) ON DELETE CASCADE",
      );
    if (!has("display_name")) db.exec("ALTER TABLE activities ADD COLUMN display_name TEXT");
    if (!has("stable"))
      db.exec(
        "ALTER TABLE activities ADD COLUMN stable INTEGER NOT NULL DEFAULT 0 CHECK (stable IN (0, 1))",
      );
    db.exec("CREATE INDEX IF NOT EXISTS idx_activities_product ON activities(product_id, ref_num)");

    // One product per (collection, product code) that already has refs. The lowest ref
    // number becomes canonical and supplies the type: existing rows carry no opinion about
    // which ref owns the module, and the first one made is the least surprising answer.
    const groups = db
      .prepare(
        `SELECT collection_id AS collectionId, product_code AS productCode,
                MIN(ref_num) AS canonical, MIN(created_at) AS createdAt
           FROM activities WHERE product_id IS NULL
          GROUP BY collection_id, product_code`,
      )
      .all() as {
      collectionId: string;
      productCode: string;
      canonical: number;
      createdAt: string;
    }[];
    const now = new Date().toISOString();
    for (const group of groups) {
      const project = db
        .prepare("SELECT project_id AS projectId FROM activity_collections WHERE collection_id = ?")
        .get(group.collectionId) as { projectId: string } | undefined;
      // A collection with no row is already unreachable; leaving its activities without a
      // product keeps this migration total rather than inventing a project for them.
      if (!project) continue;
      const canonical = db
        .prepare(
          "SELECT activity_type AS activityType FROM activities WHERE collection_id = ? AND product_code = ? AND ref_num = ?",
        )
        .get(group.collectionId, group.productCode, group.canonical) as
        { activityType: string } | undefined;
      const productId = `prd_${group.collectionId}_${group.productCode}`.replace(
        /[^A-Za-z0-9_]/g,
        "_",
      );
      db.prepare(
        `INSERT INTO activity_products
           (product_id, project_id, collection_id, product_code, module_folder,
            canonical_ref_num, activity_type, book_mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
         ON CONFLICT(collection_id, product_code) DO NOTHING`,
      ).run(
        productId,
        project.projectId,
        group.collectionId,
        group.productCode,
        `waf-module-${group.productCode}`,
        group.canonical,
        canonical?.activityType ?? "standard",
        group.createdAt ?? now,
        now,
      );
      db.prepare(
        `UPDATE activities SET product_id =
           (SELECT product_id FROM activity_products WHERE collection_id = ? AND product_code = ?)
          WHERE collection_id = ? AND product_code = ?`,
      ).run(group.collectionId, group.productCode, group.collectionId, group.productCode);
    }
  },
  down(db) {
    // Ref rows keep their product code, so this loses only the canonical marker, the
    // module folder, and each ref's name and stability.
    db.exec(`
      DROP INDEX IF EXISTS idx_activities_product;
      ALTER TABLE activities DROP COLUMN stable;
      ALTER TABLE activities DROP COLUMN display_name;
      ALTER TABLE activities DROP COLUMN product_id;
      DROP INDEX IF EXISTS idx_activity_products_collection;
      DROP TABLE IF EXISTS activity_products;
    `);
  },
};
