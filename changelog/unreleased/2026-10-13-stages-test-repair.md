# The Stages test the build they made, and repair it once when checks fail

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#126](https://github.com/nicolaepocroianu/penguin-harness/pull/126)

The Stages' test step played the module build the sequence had just assembled rather than
whatever the preview played, and every test run recorded the build it played. When checks that
ran saw the module do something wrong, the step ran one repair round: a module run started from
the tested build's sources, told which checks failed and what they saw, and the same test file
ran again against what it built. The step stayed succeeded either way, with a note when checks
still failed.

## Details

- `ActivityAcceptance.testRun` took an optional module build to play, refused one that is not a
  module build of the activity that succeeded, and otherwise played the build the preview plays.
  Every test run recorded the build it played as `test.moduleRunId` (none for a module in the WAF
  checkout), and its play link played that build.
- A module request took `repair: { fromRunId, testRunId }`. A repair kept the canonical-ref and
  reading-mode refusals (taking the repaired build's reading mode when it named none), refused a
  build that did not succeed, tests that did not finish or played another build, and tests whose
  only failures never ran. Over the usual scaffold it staged the tested build's `module/src`,
  `module/res`, `module/configurations` and `module/definition.json` (never its build output),
  `repair/repair.json` with each failed check, and a read-only copy of the test file, and its
  agent was told to fix the module as the specification says and to name a check that asks for
  something the specification does not say.
- The repair round ran only when a check that ran failed; a check that never ran, or tests of a
  module in the WAF checkout, noted `testsFailing` instead. After the round, the step noted
  `testsStillFailing` when checks still failed or the second run did not run the tests it was
  handed unchanged; a round that could not finish left `testsFailing`. Both notes showed on the
  succeeded step in the attention tone.
- The outcome ledger took a test run's build from its record. A run of another kind applying a
  part another run made (a media pass over a specification) counted as an edit by a run
  (`edits.run`) on the run that made it rather than replacing it, and a deploy credited both.
  `accepted_by` named whoever started the run, or the run, when no actor was named.
- Existing prompts and staged files stayed as they were; the repair's prompt and staged files
  were pinned as a new entry of the run-kinds golden test.
