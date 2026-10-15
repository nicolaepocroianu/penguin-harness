# The activity studio shows one journey, with one next step

- **Date:** 2026-10-15
- **Type:** feature
- **Scope:** `web`, `server`

Phase 3 of the Activity Studio audit. The header shows the activity's journey in six steps:
Script, Specification, Media, Module, Checks and Deploy. Each step says where it stands in a mark
and in words. One next-step button replaces "Next: …". It says how many steps stand between the
activity and QA and opens a list of them, blockers first, each with a button that goes where it
is fixed. The button never offers QA while the deploy would refuse it. Four tools on the right
edge (Preview, Stages, Checks, Chat) replace the six panel chips. Deploy says a blocker once,
next to its fix, and shows QA and PROD as two lanes.

## Details

- **Journey.** The six steps replace the progress chips. A step's state is carried by its mark's
  shape (a tick, an alert, a lock, a cross, a turning ring, an empty ring) and its words. Its
  tone comes from `tone.ts`. The step of the open section wears the rail's selection. Media
  counts placeholders apart from real files. Module gives the newest build's date, or says it
  is older than the draft. Checks sums the tests, the quality checks and the player check.
  Deploy says Blocked while the deploy would refuse to start.
- **Readiness list.** The next-step button reads "N steps to QA", "Ready for QA", "Deploying to
  QA" or "On QA". It opens what stands before QA. Blockers are exactly what the deploy refuses:
  no module to ship, or a problem the server says keeps its stages from starting (for example
  the module clone has no main branch). They come first. Everything else is a recommendation:
  unsaved edits, an unvalidated specification, missing clips, placeholders, a build older than
  the draft, checks not run or failing, a QA deploy that failed or is behind. Each item's button
  goes where it is fixed and changes nothing itself. The list is a pure, tested model
  (`journey-model.ts`). "Ready for QA" needs the deploy state read and free of blockers.
- **Tool rail.** Preview, Stages, Checks and Chat sit on a rail at the right edge. Layout sits
  at its foot. Checks marks failures and open quality findings with a dot. Tests and Quality
  are one Checks panel, which also shows the player check the playing build ran when it was
  assembled. Its failing scenarios are open and the passing ones are folded. Sessions is gone
  from the rail. Each run in History shows its Session's transcript in place, and the header's
  running chip opens History with that run's transcript when no tool follows it.
- **Stored layouts.** Saved layouts and the remembered panel keep their keys: Stages, Preview and
  Chat store `run`, `player` and `conversation` as before, and Checks stores `checks`. A stored
  `tests` or `quality` reads as Checks, and a stored `sessions` reads as no panel. This happens
  on read only. Nothing stored is rewritten until the author chooses a tool or saves a layout.
- **Deploy.** What is missing is said once, in the strip, beside its fix. The checks that fail
  are open under it, and the rest fold behind "Show all N checks", which replaces "Repository &
  branch details". A stage or the PROD lane blocked by a listed problem points to it ("Waits for
  what is missing above.") instead of saying it again. A failing clone check names its state
  briefly ("No main branch here"). QA and PROD are two lanes, each with one primary button.
  Releasing the module on its own and running one stage at a time move to the QA lane's More
  menu. The PROD stages are a list like QA's, not a table. The log sits under both lanes. Check
  remote says what it does on hover.
- **Squeeze rules.** The header stays one row. As it narrows, the journey drops its state words,
  then its step names, keeping six marks. On a phone the next-step button keeps only its count.
  A side panel covers the work, instead of squeezing it, once the work would drop under 720
  pixels.
- **Server.** `GET .../:activityId/player-check` answers the player check of the build the
  preview plays: its scenarios as the checks reported them, or why it has none (no test browser
  at assembly, or a check that never ran). It is read through `ActivityAcceptance.playerCheck()`,
  with its types in `acceptance-types.ts`. The deploy state now carries `blocking`: the problems
  that keep every stage from starting, which a stage's own blocker names only the first of. No
  stored data changed.
- **Tests.** Unit tests cover the journey's steps, the readiness list and its blocker rule over
  every combination, the next-step button, the checks summary and its mark, the stored panel
  keys and layouts, the 720-pixel rule, and a deploy blocker said once. Server tests cover the
  player-check route and the blocking problems. A new activities e2e test follows a blocked
  deploy from the journey through the readiness list to Deploy. The e2e tests for the moved
  panels, the History transcript and the deploy lanes were updated.
