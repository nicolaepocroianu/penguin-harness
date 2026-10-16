# Admins clean up activity runs by hand from System settings

- **Date:** 2026-10-16
- **Type:** feature
- **Scope:** `server`, `web`

System settings gained an admin-only page, Activity storage. It showed how much disk every
activity run folder took together, and offered a cleanup the admin started by hand: "Find what
can be removed" listed, per category, how many folders or files and how many bytes would go, and
"Clean up" confirmed that dry run. Nothing was scheduled. The cleanup removed only what the dry
run had listed and was still eligible when it ran, never more; what had come to be needed since
was kept and counted, and the page said so. A dry run could be confirmed once, for ten minutes;
the page made it again before confirming when it was five minutes old.

## Details

- The cleanup removed, in this order: the staged media copies (`media/`) and agent-installed
  packages (a real `module/node_modules`) of finished module runs; the folders of finished runs
  beyond the newest of their activity and kind, a number the admin chose (default 5, from 1 to
  100), the newest succeeded run of each kind kept as well; and, only when switched on, takes
  nobody accepted (`candidates/<runId>.<ext>`) of runs the server did not have, in the media of
  the WAF workspace the server prepares, while no git work ran on the media repository. That
  covered takes of deleted projects and activities, and also takes a git pull or Loom brought
  whose run this server never had. Writing or accepting a take was not held back meanwhile. An
  existing checkout's takes were not looked at, and the page said so.
- It never removed a running run, or a run whose Session was still working (a turn running, or
  background tasks going on), since a user could go on talking to a run's Session from the chat;
  the module build the preview played, the pinned run, the newest succeeded build or one a live
  play link played; any module run of an activity while its deploy ran; the build and tests a
  repair round started from, or a build a finished test run played while it was still of the
  current draft; a run the outcome ledger pointed at (a source of the draft's parts, or one
  credited with a deploy); the folders of test and quality runs, compositions, recordings,
  timeline renders and conversations (assist runs, whose folder held the proposal and the thread
  the conversation panel resumed); or anything of an activity whose draft could not be read, which
  the page counted instead. The ledger and the live play links were read before anything was
  removed, so a ledger that could not be read stopped the cleanup with nothing removed.
- Links were never followed, neither to count bytes nor to remove: a module run's link to the
  shared module packages was left as it was, and so was a `candidates` folder reached through
  one. Each activity's runs were cleaned while the activity was held, so none could start or
  be pinned meanwhile.
- A folder or file that could not be removed was left in place, named in the server log, and
  counted in the result.
- Pinning a build whose folder a cleanup had removed was refused with 409 `module_build_removed`,
  which the page explained.
- New admin routes: `GET /api/admin/activity-run-cleanup/storage`, `GET .../plan?keepNewest=<n>
  [&orphanTakes=1]` (removes nothing; answers the dry run with its `planId`) and `POST .../apply`
  with `{ planId }` (409 `run_cleanup_plan_expired` once that dry run could no longer be
  confirmed), backed by a new `ActivityRunCleanup` component. Play links signed for a module run were
  remembered until they expired, so the cleanup could tell which runs a live link played.
- No stored shape changed.
