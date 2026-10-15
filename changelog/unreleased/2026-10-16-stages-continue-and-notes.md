# Stages continue from the stage a sequence stopped at, and say when a module failed its player check

- **Date:** 2026-10-16
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#153](https://github.com/nicolaepocroianu/penguin-harness/pull/153)

A sequence of every stage that failed or was stopped could be taken up where it stopped: the
Stages panel showed "Continue from <stage>" under its summary, which ran that stage and every one
after it, and none before it. The module stage also said when the module it built had failed its
player check, or when that check's results could not be trusted, where it had read as a plain
success before.

## Details

- `POST …/pipeline` took `stage: { from: <step> }` beside the stage names it took before; the
  sequence ran the steps "all" runs, from that step on, and kept `selection: { from: <step> }` in
  its record. The history named such a sequence "All stages from <stage>".
- Continue was offered on the latest sequence only, when it had run every stage (from the start,
  or from a stage on), and was held while the stages could not be run. It kept the sequence's
  language and asset scope.
- A sequence taken up at the tests played what the preview plays, as the tests run on their own
  do; one taken up at the module tested the build it made.
- The module step read its run's player check as the outcome ledger counts it. A run that changed
  the files its check rests on was noted `moduleCheckUntrusted` ("its results cannot be trusted"),
  ahead of any other note about the check, and one whose check had a failing criterion was noted
  `moduleChecksFailing`. The run and its step stayed succeeded, and the build stayed usable.
