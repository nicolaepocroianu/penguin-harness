# A test run that changes what its checks rest on is reported untrusted

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#PR](https://github.com/nicolaepocroianu/penguin-harness/pull/PR)

As a test run ended, the server compared the harness, the runner and the input it had staged for
the run's checks with what the run left, by their SHA-256, and marked the report of a run that
changed any of them `untrusted`. The Tests panel said such results cannot be trusted. The Stages
repaired nothing from such a report and took no such report as showing a repair worked, and the
outcome ledger counted it as `tests.untrusted` with none of its criteria.

## Details

- A repair run recorded the SHA-256 of the test file it was handed (`repair.testSha256`). The
  Stages took the second tests as showing the repair worked only when they ran that same file, so
  a repair run that rewrote the first tests' file left `testsStillFailing`.
- A repair needed tests that named the build they played, and refused a build assembled from an
  earlier draft (`repair_build_stale`), whose configuration the draft no longer has.
- `edits.run` in the outcome ledger counts an edit by any later run of another kind, however it
  was applied: an assist proposal an author applies counts there too.
