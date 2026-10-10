# Remove the activity stage registry and runtime AI rules that nothing used

- **Date:** 2026-10-10
- **Type:** refactor
- **Scope:** `activities`

Removed seven server modules that the running harness never called, together with their tests.
Nothing an author sees changes.

## What went

- The stage registry kernel slot (`stage-registry.ts`) and its three stages (`prepare-media-stage.ts`,
  `scaffold-stages.ts`). The slot was never registered in the platform, so the stages ran only in
  their tests. Run all stages is `ActivityPipelineService`, and a module run scaffolds its module
  itself.
- The stage graph, its pipeline declaration and the three run modes (`stages.ts`, `pipeline.ts`,
  `run-modes.ts`). Only the registry and tests read them. Staleness is reported where each step
  works it out: the activity summary, build readiness and acceptance.
- The runtime AI admission rules (`runtime-ai.ts`). They were written for activities that ask an
  AI service while a learner plays them. No Loom module does that. Loom's AI endpoint was the
  author's prompt box in its sandbox, which the chat beside the studio preview already covers.
