# Player checks run three at a time

- **Date:** 2026-10-10
- **Type:** perf
- **Scope:** `server`

`run-acceptance.mjs` now runs up to three checks side by side, each in its own browser context,
and each check closes only the pages it opened. Checks play an activity's media in real time,
so one after another they made each run of a module stage's player check take up to two
minutes; test18's module stage spent 16 of its 35 minutes on them. On test19's four checks a run
went from 14 to 7 seconds with the same results. Results are still written in the order the
checks were registered.
