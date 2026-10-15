# A deploy started again follows the Jenkins build already started, and a release holds only checked files

- **Date:** 2026-10-16
- **Type:** fix
- **Scope:** `server`, `web`
- **PR:** [#155](https://github.com/nicolaepocroianu/penguin-harness/pull/155)

A deploy started again after its wait was stopped, timed out or cut short by a restart no longer
queued a second Jenkins job while the first was still going or had already succeeded: each trigger
stage followed the build its last start began instead, and the wait after it recorded that build.
The module release took a release tag only once its own Jenkins build had succeeded, and only a
tag that holds the commit the build was started for. `prepare_deploy` committed only the files it
wrote, so a draft saved into the module clone while `verify_module`'s checks ran stayed out of the
release. The PROD card offered **Wait for the PROD deploy** first once a PROD deploy had started
and the wait for it had not finished.

## Details

- `trigger_module_build` recorded the deploy branch's commit it pushed (`buildCommit`, a new field
  in the run's metadata). Run again while `await_module_build` was not done since, with the deploy
  branch holding the same files as that commit (verify and prepare run again commit them anew), it
  pushed nothing and started nothing when Jenkins had the last start's build queued or building,
  or succeeded with a release tag holding its commit; it carried that start's tag, build number and
  commit to the wait.
- `trigger_activity_deploy` did the same while no new activity data had been published in the run
  and the QA framework version was unchanged, and `trigger_production_deploy` while the PROD
  framework version was unchanged.
- Otherwise a trigger found by its parameters any build still queued or building and failed with
  the new stage error `build_in_flight`, naming its page, rather than start a second beside it.
  The newest build, queue included, was the floor the new build was looked for above; the Jenkins
  client's `skipQueue` read was removed.
- `await_module_build` followed the build until Jenkins reported it succeeded, failed or the
  configured minutes passed, and then took the oldest plain semver tag newer than the one noted
  that holds the build's commit (`git merge-base --is-ancestor`). A succeeded build whose newer
  tags all lacked the commit failed with the new stage error `tag_without_commit`, naming the
  newest of them. A start recorded before `buildCommit` existed was matched against the deploy
  branch's commit.
- `prepare_deploy` staged `package.json`, `package-lock.json` and `res/style.css` when it had
  written and changed them, in place of `git add --all`, and logged every other changed path
  (the first 20 and how many more) as left out of the deploy commit. `verify_module` still
  committed the whole working tree as authored.
- The clone gained `changes`, `commitOf`, `sameContent` and `tagHolds`.
- The PROD card showed **Wait for the PROD deploy** as its primary action, beside **Deploy to
  PROD**, when the PROD deploy's start was done and its wait had failed, been stopped or been cut
  short by a restart, unless Jenkins had reported that deploy failed. It started
  `await_production_deploy` on its own, without the typed product code, and the line under the
  buttons said why waiting came first.
- A module build that had not succeeded in time read "The build had not succeeded within N
  minutes."
