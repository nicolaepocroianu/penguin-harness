# Admins clean up activity runs by hand from System settings

- **Date:** 2026-10-16
- **Type:** feature
- **Scope:** `server`, `web`

System settings gained an admin-only page, Activity storage. It showed how much disk every
activity run folder took together, and offered a cleanup the admin started by hand: "Find what
can be removed" listed, per category, how many folders or files and how many bytes would go, and
"Clean up" confirmed those numbers and removed them. Nothing was scheduled. The server worked the
same choice out again when the cleanup ran and removed only what was still eligible.

## Details

- The cleanup removed, in this order: the staged media copies (`media/`) and agent-installed
  packages (a real `module/node_modules`) of finished module runs; the folders of finished runs
  beyond the newest of their activity and kind, a number the admin chose (default 5, from 1 to
  100), the newest succeeded run of each kind kept as well; and, only when switched on, takes
  nobody accepted (`candidates/<runId>.<ext>`) of runs the server no longer had, in the media of
  the WAF workspace the server prepares, while the media repository was held. An existing
  checkout's takes were not looked at, and the page said so.
- It never removed a running run; the module build the preview played, the pinned run, the newest
  succeeded build or one a live play link played; the build and tests a repair round started
  from, or a build a finished test run played while it was still of the current draft; a run the
  outcome ledger pointed at (a source of the draft's parts, or one credited with a deploy); the
  folders of test and quality runs, compositions, recordings and timeline renders; or anything of
  an activity whose draft could not be read, which the page counted instead.
- Links were never followed, neither to count bytes nor to remove: a module run's link to the
  shared module packages was left as it was, and so was a `candidates` folder reached through
  one. Each activity's runs were cleaned while the activity was held, so none could start or
  be pinned meanwhile.
- A folder or file that could not be removed was left in place, named in the server log, and
  counted in the result.
- New admin routes: `GET /api/admin/activity-run-cleanup/storage`, `GET .../plan?keepNewest=<n>
  [&orphanTakes=1]` (removes nothing) and `POST .../apply` with `{ keepNewest, orphanTakes }`,
  backed by a new `ActivityRunCleanup` component. Play links signed for a module run were
  remembered until they expired, so the cleanup could tell which runs a live link played.
- No stored shape changed.
