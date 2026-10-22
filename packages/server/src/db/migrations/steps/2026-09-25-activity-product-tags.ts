import type { Migration } from "../migration.js";

export const activityProductTags: Migration = {
  name: "2026-09-25-activity-product-tags",
  // Swap-safe: a new table no older reader or writer knows about, so either build runs
  // against it unchanged.
  swapSafe: true,
  up(db) {
    // Free-text labels an author gives a product ("grade 1", "phonics"); every ref of the
    // product shares them. Position keeps the order the author typed them in.
    db.exec(`
      CREATE TABLE IF NOT EXISTS activity_product_tags (
        product_id TEXT NOT NULL REFERENCES activity_products(product_id) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        position INTEGER NOT NULL,
        PRIMARY KEY (product_id, tag)
      );
    `);
  },
  down(db) {
    // Loses only the tags; products and refs are untouched.
    db.exec("DROP TABLE IF EXISTS activity_product_tags");
  },
};
