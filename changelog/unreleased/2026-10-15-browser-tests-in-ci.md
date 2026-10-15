# Browser tests ran in CI

- **Date:** 2026-10-15
- **Type:** process
- **Scope:** `ci`, `server`, `web`
- **PR:** [#143](https://github.com/nicolaepocroianu/penguin-harness/pull/143)

No CI job installed Playwright's Chromium, so the server suites that drive a real browser
skipped on ubuntu, macOS and Windows and the jobs still passed: the confined checks the server
runs itself, the activity bench's check runner and sealing proofs, and the keyboard probe. The
web app's Playwright suite did not run in CI at all. The server test shards on all three
platforms installed Chromium and failed where it was missing, and a new ubuntu job ran the
web's `activities` Playwright project.

## Details

- A composite action, `.github/actions/chromium`, installed the `chromium` build that a
  package's Playwright drives (`--with-deps` on Linux), cached Playwright's browser folder per
  OS keyed on the `playwright-core` versions `pnpm-lock.yaml` resolves, and set
  `PENGUIN_TEST_REQUIRE_BROWSER=1` for the rest of the job.
- The ubuntu and macOS `server` shards and the Windows `server-1` to `server-3` shards ran the
  action before their tests.
- The server's browser suites (`activity-confined-checks`, `activity-bench-harness`,
  `activity-quality-probe`) took the executable from one test helper, `installedChromium()`,
  which throws when `PENGUIN_TEST_REQUIRE_BROWSER=1` and Chromium is not installed. Without the
  variable a machine with no Chromium still skips those suites.
- The `e2e-web (activities)` job built core and the web app, installed Chromium through the
  web's `@playwright/test`, ran `playwright test --project activities`, and uploaded the
  Playwright results when it failed. It joined the `ci` gate. The `shared-server` project
  stayed out of CI.
- The development skill's verification section named the web `activities` project as part of
  the chain CI runs and listed the server's real-browser suites with the sources they cover;
  the frontend skill's Verify gave the commands to run the `activities` project locally.
