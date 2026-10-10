# Rolling back the reported-cost migration works again

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `server`

Rolling the database back past migration 19 (`usage-reported-cost`) failed with "incomplete input".
The comment on the column before `reported_cost_usd` held commas, and SQLite's `DROP COLUMN` cut
the table's definition at one of them. The comment no longer has commas, and the migration says why.
A database created before this fix still has the old comment, so rolling it back past migration 19
still fails.
