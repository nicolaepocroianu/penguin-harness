# An activity run that works past its time limit is stopped and fails

- **Date:** 2026-10-15
- **Type:** feature
- **Scope:** `server`, `web`

Every kind of activity run whose agent works in a Session was given a time limit, counted from
the moment the run opened. A run still working past it failed with the limit named ("The module
run was stopped after 120 minutes, its time limit."), and its Session's task, or the server's own
work in its place, was stopped the way Stop stops it. The Stages waiting on the run ended there,
as they do on any failed run, and started nothing after it. The outcome ledger recorded
`limit: time` on the run's settled fact and counted it as `limit.time`.

## Details

- The kinds' limits: two hours for a module build (its build and three full runs of player
  checks), one hour for acceptance tests (two full runs of checks), twenty minutes for an image
  (the helper's install and one run of it), fifteen minutes for media text and phonemes, and half
  an hour for every kind that writes documents and runs no program: the specification and media
  passes, the assessment, a scene composition, its timeline and critique, and an assist
  conversation's first reply.
- A run whose Session had already finished was settled as before, however long ago it opened.
- An admin could replace every kind's limit with one of their own in System settings, WAF
  workspace, Run time limit (`activityRunLimitMinutes` on `/api/admin/settings`: whole minutes
  from 1 to 1440, or null for each kind's own; anything else was refused with
  `invalid_run_limit`). It was read on every pass over the running runs, so it reached runs
  already working, with no restart.
- A kind's `limits.wallClockMs` joined the Session run-kind contract; the engine read time from
  the server's clock, which a test replaces.
