# Admins can read the outcome ledger

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `server`
- **PR:** [#128](https://github.com/nicolaepocroianu/penguin-harness/pull/128)

`GET /api/admin/activity-outcomes/tally` answered the
[outcome ledger](2026-10-13-activity-outcome-ledger.md)'s counts for one run kind (`kind`), per
recipe or per part of one (`by`), narrowed by `projectId`, any number of `activityId`, and a
`since` / `until` window on when runs started. `GET /api/admin/activity-outcomes/history` answered
one activity's runs (`projectId`, `activityId`, optionally one `runId`), oldest first, with their
recipes and facts. Both were for admins only, since the ledger holds every project's runs, and
refused a query they could not answer with 400.

## Details

- The response shapes, `OutcomeTallyResponse` and `OutcomeHistoryResponse`, and the ledger's types
  were exported from `@prismshadow/penguin-server/api`.
