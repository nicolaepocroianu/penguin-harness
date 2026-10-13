# Each activity run's recipe and outcome are recorded

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `server`
- **PR:** [#124](https://github.com/nicolaepocroianu/penguin-harness/pull/124)

A kernel module of the activities, `ActivityOutcomes`, recorded each activity run's recipe and
what became of the run after it ended, in four new tables (migration 25, `activity-outcomes`).
The generation engine showed it each run as it opened, as its agent started working and as it
ended, and an assist run as its proposal was discarded; `ActivityService.change()` showed it
every change to a draft; it listened to deploys through `ActivityDeployEvents`. It answered with
`tally` (counts for one run kind, per recipe or per part of one) and `history` (one activity's
runs, each with its recipe and facts). No route, prompt, staged file or screen changed.

## Details

- A run's recipe was fixed as its agent started: who answered (the Penguin agent's provider and
  model as its Session was created, a coding agent, or the helper or local model the server ran
  for it), the bundled skills and helpers its workspace was given, matched by digest against the
  waf-authoring and agent-development plugins, the harness version of a module or test run, and
  Penguin's version. A run no agent works was the server's from the moment it opened. The
  prompt's digest and the build's commit were kept beside the recipe.
- As a run ended, what its checks found was kept as numbers, read once from its record and its
  folder: an acceptance test report's criteria by how they ended, a module run's player check, a
  quality run's blocking findings, a recording's video check, a composition's lint, a critique's
  score. A test or quality run's numbers were also credited to the module build it played.
- A later run of the same kind and target marked the earlier ones superseded; conversations never
  supersede one another.
- Each change to a draft was kept per part (the script, the specification, each media asset per
  language, the rest of the media plan, each edited module document) as digests, sizes and the
  number of bytes the change rewrote, never as text, and as an edit or a return to an earlier
  version. With nothing yet naming who made a change, every change counted as unattributed. A
  changed pin was kept to tell which build a later test or quality run played.
- A deploy that reached QA or PROD credited the module build it shipped. `DeployedEvent` gained
  `moduleRunId`, which the deploy recorded in its stage metadata from `verify_module` on to the
  QA and PROD wait stages.
- Nothing the ledger did could fail its caller: a moment it could not record was logged and
  dropped. Runs from before it are covered in the
  [backward compatibility](2026-10-13-backward-compatibility.md) entry.
