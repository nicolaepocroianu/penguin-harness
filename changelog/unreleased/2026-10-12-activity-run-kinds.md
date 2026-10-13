# Each kind of activity run is a module of its own

- **Date:** 2026-10-12
- **Type:** refactor
- **Scope:** `server`

Every kind of activity run moved out of the generation service into a module of its own under
`packages/server/src/activities/run-kinds/`: the specification and media passes, module
assembly, speech and sounds, images, media text, conversations, assessments, acceptance tests,
word sounds, scene compositions, timelines and critiques. Each kind kept, behind one contract,
when a run may start (`check`, then `authorize` against the owning Agent's Vault), what the run
records, what it stages in its workspace, what its agent is told, the files it must write, how
what was written becomes the candidate, and how an accepted candidate changes the draft. The
generation service kept the shared engine: the activity's lock, the run store, Sessions and
their observers, the speech and sound helpers, cancellation, shutdown, and the step that keeps
a candidate only while the draft is the one the run started from.

`ActivityGeneration.start` took a request told apart by `kind` (`{ kind: "speech", speech }`,
`{ kind: "media-spec", repair }`, …) instead of an options object, and the routes, stage
sequences, scene improvement and acceptance tests built one. `ActivityRun` became a union
told apart by `kind`, each kind with the fields it records. `canRun` answered whether a run may
start without starting it.

## Details

- A test pinned, for a fixed activity of each kind, the prompt and the files staged in the
  run's workspace, with the values captured before the move; both stayed as they were.
- The HTTP routes took the same bodies and answered the same responses; the run records, their
  JSON and the run folders were kept as they were.
