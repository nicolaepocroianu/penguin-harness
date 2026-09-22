# A server with an existing database could not start

- **Date:** 2026-09-22
- **Type:** fix
- **Scope:** `server`

`openDatabase` runs `SCHEMA_SQL` and only then migrates, so every statement in `SCHEMA_SQL`
has to be legal against the oldest database still in the wild. Two were not:

```
CREATE INDEX idx_activities_product  ON activities(product_id, ref_num)
CREATE INDEX idx_activity_runs_kind  ON activity_runs(activity_id, kind)
```

`product_id` and `kind` arrive with migrations 18 and 17. `CREATE TABLE IF NOT EXISTS` does
nothing to a table that already exists, so on any database formed before those migrations
the columns were absent and the index failed with **`no such column: product_id`** — before
a single migration had run. The server exited at startup and no upgrade path existed.

The four columns are now added, if their table is already there, immediately before
`SCHEMA_SQL`. A fresh database has no tables at that point, so nothing happens and
`SCHEMA_SQL` creates them complete; the migrations still own the backfill and skip the
`ALTER`s they find already applied.

`SCHEMA_SQL` keeps declaring both indexes, so it remains the single full statement of the
current shape — the property the migration suite checks by comparing a fully migrated
database against a freshly created one.

## Why the tests missed it

Every old database in `db-migrations.test.ts` is built from `SCHEMA_SQL` and then stripped
of what came later — right for exercising migrations, but the tables always have the
**current** columns, so this class of failure cannot appear.

The new cases roll a real database back instead, and one of them opens a database at the
version before *every* migration. An index added to `SCHEMA_SQL` over a migration-added
column now fails that case at the version before its migration.
