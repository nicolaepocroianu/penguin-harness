# A test run that changes what its checks rest on is reported untrusted

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#127](https://github.com/nicolaepocroianu/penguin-harness/pull/127)

As a test run ended, the server compared the harness, the runner, the input and the
playwright-core pin it had staged for the run's checks with what the run left, by their SHA-256,
and marked the report of a run that changed any of them `untrusted`. The Tests panel said such
results cannot be trusted. The Stages repaired nothing from such a report and noted
`testsUntrusted` on the step, and the outcome ledger counted it as `tests.untrusted` with none of
its criteria.

## Details

- The comparison is of what the run left: a run that put a file back as it was, or wrote its
  results by hand, is not caught. A report without `untrusted` is not verified, only not caught.
- A kind's `stage` may record on its run what it staged; the engine saves the run's record before
  its Session starts.
- A repair run recorded the SHA-256 of the test file it was handed (`repair.testSha256`). The
  Stages took the second tests as showing the repair worked only when they ran that same file, so
  a repair run that rewrote the first tests' file left `testsStillFailing`.
- A repair needed tests that named the build they played, and refused a build assembled from an
  earlier draft (`repair_build_stale`), whose configuration the draft no longer has.
- `edits.run` in the outcome ledger counts an edit by any later run of another kind, however it
  was applied: an assist proposal an author applies counts there too.
