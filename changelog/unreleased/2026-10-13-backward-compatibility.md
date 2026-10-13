# Backward compatibility

- **Date:** 2026-10-13
- **Type:** process
- **Scope:** `server`
- **PR:** [#124](https://github.com/nicolaepocroianu/penguin-harness/pull/124)

The [outcome ledger](2026-10-13-activity-outcome-ledger.md) added migration 25
(`activity-outcomes`): the tables `activity_outcome_recipes`, `activity_run_outcomes`,
`activity_outcome_facts` and `activity_draft_parts`. It rewrote no existing row, and the runs'
records, their folders and the drafts stayed as they were.

## Runs from before the ledger

A run that started before the ledger has no row and gets none: nothing was backfilled. One that
was still going when the ledger shipped is recorded as it ends, with its recipe unknown. A run
with an unknown recipe is left out of every tally and shown with no recipe in its history; its
check numbers are still kept.

This tolerance is permanent: no recipe can be recovered for those runs, so there is nothing to
migrate them to. It is the null recipe in `ActivityOutcomeLedger` (a run first seen as it ends)
and the join that leaves such runs out of `tally`. It could only be removed once no project holds
a run started before migration 25, which nothing guarantees; whoever changes `tally` keeps it.

## Compatibility

Migration 25 is swap-safe: a pushed platform applies it without a restart, and an older build
neither reads nor writes the new tables. Rolling it back drops the four tables and loses every
recorded recipe and outcome; the runs, their folders and the drafts stay.

A deploy's stage metadata gained an optional `moduleRunId`, the module build `verify_module`
checked, carried to the QA and PROD wait stages. It rewrote no existing record: a deploy recorded
before it has none, and its event names no build. An older build ignores the field.
