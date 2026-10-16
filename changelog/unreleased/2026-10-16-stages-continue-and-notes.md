# Stages continue from the stage a sequence stopped at, and say when a module failed its player check

- **Date:** 2026-10-16
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#153](https://github.com/nicolaepocroianu/penguin-harness/pull/153)

A sequence of every stage that failed or was stopped could be taken up where it stopped: the
Stages panel showed "Continue from <stage>" under its summary, which ran that stage and every one
after it, and none before it, with what the stopped sequence had run with. The module stage also
said when the module it built had failed its player check, had checks that did not run, or when
that check's results could not be trusted, where it had read as a plain success before.

## Details

- `POST …/pipeline` took `stage: { from: <step> }` beside the stage names it took before; the
  sequence ran the steps "all" runs, from that step on, and kept `selection: { from: <step> }` in
  its record. The history named such a sequence "All stages from <stage>". A selection naming no
  step was refused rather than run from the last step.
- Every sequence's record kept, under an optional `inputs`, the agent, coding agent, voice, sound
  provider and book mode it was started with. Continue repeated them, with the sequence's language
  and asset scope, whatever the controls held by then; a sequence recorded before `inputs` was
  kept was continued with the agent and voice the controls held. A running sequence was named by
  the agent it was started with.
- Continue was offered on the latest sequence only, when it had run every stage (from the start,
  or from a stage on). A sequence of every stage stopped before its first stage started a run was
  not offered it, since Run did the same; one from a stage on, stopped the same way, was still
  offered it at that stage. While the stages could not be run, Continue was held and said why
  beside it, as its description.
- A sequence taken up at the tests played what the preview plays, as the tests run on their own
  do; one taken up at the module tested the build it made.
- The module step read its run's player check as the outcome ledger counts it. A run that changed
  the files its check rests on was noted `moduleCheckUntrusted` ("its results cannot be trusted"),
  ahead of any other note about the check; one whose check had a failing criterion was noted
  `moduleChecksFailing`, and one whose check had criteria that did not run, `moduleChecksNotRun`.
  The run and its step stayed succeeded, and the build stayed usable.
- When the tests passed on a build the repair round had rebuilt, the test step carried the same
  notes about that build's own player check. Tests that still failed, or could not be trusted,
  were noted first.
