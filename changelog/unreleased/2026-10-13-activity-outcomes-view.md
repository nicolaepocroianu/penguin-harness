# Admins read what became of activity runs in System settings

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#136](https://github.com/nicolaepocroianu/penguin-harness/pull/136)

System settings gained an **Activity outcomes** page for admins. It reads the
[outcome ledger](2026-10-13-activity-outcome-ledger.md) one run kind at a time, and counts its runs
per recipe or per runtime. A row shows:

- how many runs succeeded;
- how many needed a repair round;
- how many had their candidate accepted;
- how many edits and reverts there were;
- how many runs reached QA and PROD;
- how many had checks nothing vouches for (untrusted).

The admin chooses how far back to read (7, 30 or 90 days, or all time) and can narrow it to one
project. Selecting a row lists that tally's newest runs, and selecting a run shows what happened
to it, fact by fact. The page only reads; it writes nothing.

## Details

- The ledger's admin route gained two reads:
  - `GET /api/admin/activity-outcomes/runs` answers the runs one tally counted, given the tally's
    query and its key. An empty `key` names the tally whose recipes have no such part. Runs come
    newest first, at most 50.
  - `GET /api/admin/activity-outcomes/projects` answers the projects the ledger holds runs of.
  - Both are for admins only, as the rest of the route is.
- `ActivityOutcomes` gained `tallyRuns` and `projects`. Tallies and tally runs share one query.
- The web app reads the route through typed endpoints, `adminOutcomeTally`, `adminOutcomeRuns`,
  `adminOutcomeHistory` and `adminOutcomeProjects`, and shows nothing to a non-admin.
- No schema changed. The page reads the tables migration 25 added.
