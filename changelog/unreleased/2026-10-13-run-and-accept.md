# A run and its acceptance are one call

- **Date:** 2026-10-13
- **Type:** refactor
- **Scope:** `server`
- **PR:** [#123](https://github.com/nicolaepocroianu/penguin-harness/pull/123)

`ActivityGeneration.runAndAccept` started a run, waited for it to end, and accepted its
candidate into the draft, answering `accepted`, `succeeded` (a kind that keeps its own result:
a specification, a module, test reports), `skipped`, `failed` or `stopped`. It waited on the
run ending rather than polling the run list, and accepted only on the draft the run started
from. A refusal a run kind marks as leaving the work undone (an image provider without its key,
a specification without an assessment, a ref that does not own the assessment) carried a typed
reason, and started nothing.

The Stages ran every step through that call and one small port, `StagesPort`, in place of the
generation and authoring services; the steps no longer re-read the draft to accept, re-checked
what the run kinds check, or matched error codes to decide what to skip. Stop and a component
going away aborted the wait, and nothing was accepted after them.

## Details

- The acceptance service's `testRun` built the test run the Stages start, the one place that
  chooses what the tests play.
- The assessment in effect for a ref was read in one place, `ActivitySandbox.currentAssessment`,
  and the scene-video experiment refused in one, `ActivityGeneration.requireVideoExperiment`.
- HTTP routes, notes and stored stage records kept their shapes; prompts and staged files stayed
  as the golden test pins them.
