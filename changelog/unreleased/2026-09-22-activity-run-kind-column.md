# A generation run says what kind it is

- **Date:** 2026-09-22
- **Type:** refactor
- **Scope:** `server`

A generation run's kind was not stored. It was worked out by asking four tables in turn
whether they held the run's id — `activity_media_text_runs`, then `activity_image_runs`,
then `activity_audio_runs`, then `activity_module_runs`, and anything left over was a spec
run. One table per possible answer.

That holds for five kinds. The generation pipeline being ported from Loom adds a run kind
per stage, and one table per answer does not survive that. `activity_runs` now has a `kind`
column, and the four marker tables are gone.

## The migration

Migration 17 adds the column, copies each marker table's rows into it, drops the tables and
indexes `(activity_id, kind)`. It is restart-only: a collector still running would derive
every surviving run's kind from tables that no longer exist and read them all as spec runs.

Its rollback recreates the four tables and fills them from the column, and refuses when a
run holds a kind none of them can express — a stage kind added later has nowhere to go, and
saying so is better than silently demoting it to a spec run.

Adding the column is conditional, because a fresh database gets it from the schema and then
replays every migration; that is the same reason the rest of this file uses
`CREATE TABLE IF NOT EXISTS`.

## Details

- The reads now select `kind` alongside `record_json` instead of issuing up to four extra
  queries per run, so listing fifty runs costs one query rather than two hundred.
- `packages/server/test/db-migrations.test.ts` covers the historical per-kind migrations by
  rolling back to the shape that had those tables, and creates its attempts through the new
  column — so the tests now also exercise migration 17's rollback carrying kinds back into
  the tables it recreates.
