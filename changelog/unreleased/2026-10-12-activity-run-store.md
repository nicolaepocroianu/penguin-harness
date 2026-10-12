# Activity runs are kept by one store, under one lock per activity

- **Date:** 2026-10-12
- **Type:** fix
- **Scope:** `server`

Activity run records, their candidates and their folders moved behind one server component,
`ActivityRuns`: opening, saving, reading and listing runs, finding the activity whose run a
Session is, following a rebuilt Session, and the path of a run's folder. Generation, authoring,
the session index and the services that work in a run's folder (acceptance, quality, video
render, module builds, the sandbox player and deploy) went through it instead of their own
SQL or path joins.

Authoring and generation shared one lock per activity, `ActivityLock`, instead of a lock each.
Before, deleting (archiving) or renumbering an activity checked that no run was working on it
under the authoring lock while a run was opened under the generation lock, so a run opened at
the same moment could be recorded on an activity that had just been archived or renumbered.
The check and the opening now wait for each other, and the delete or renumber is refused while
the run works. An operation inside an activity's hold joins it rather than waiting for ever,
and work left running after a hold ends waits for the next one.

## Compatibility

- The `activity_runs` and `activity_run_candidates` tables, the JSON in `record_json` and the
  `activity-runs/<runId>` folders were kept as they were.
