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
and the wait for it had not finished, and the QA card did the same for the module build and the QA
deploy. The deploy's git work on the module and media clones queued with the WAF workspace's own,
and a web remote naming a user was refused.

## Details

- `trigger_module_build` recorded the deploy branch's commit it pushed (`buildCommit`, a new field
  in the run's metadata). Run again while `await_module_build` was not done since, with the deploy
  branch holding the same files as that commit (verify and prepare run again commit them anew), it
  pushed nothing and started nothing when Jenkins had the last start's build queued or building,
  or succeeded with a release tag holding its commit; it carried that start's tag, build number and
  commit to the wait.
- `trigger_activity_deploy` did the same while no new activity data or media had been published in
  the run and the QA framework version was unchanged, and `trigger_production_deploy` while the PROD
  framework version was unchanged.
- A trigger run again that found its last start's build neither queued nor listed read Jenkins once
  more, five seconds later, before starting another: Jenkins lists a build a moment after it leaves
  the queue.
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
- The deploy's git work ran in the WAF workspace's queue for its repository (`WafWorkspace.serial`,
  added to the workspace's interface), which cloning a module and adding media folders already
  used: on the module clone, `verify_module`'s fetch through its commit, `prepare_deploy`'s branch
  and its commit, the trigger's tag fetch and pushes, and the wait's tag reads; on the media clone,
  `verify_media_assets` from its fetch to its push. The npm checks, the stylesheet compile and the
  Jenkins calls ran outside it.
- A failed stage stored its error with its state, under `stageError` in the stage row's
  `metadata_json` beside the metadata, and the stage states the server sent carried it as `error`.
  A stage the server interrupted while shutting down stored `interrupted`.
- The PROD card showed **Wait for the PROD deploy** as its primary action, beside **Deploy to
  PROD**, when the PROD deploy's start was done and its wait had failed, been stopped or been cut
  short by a restart, unless Jenkins had reported that deploy failed. How the wait ended was read
  from the stored stage, or from the latest run when it was the PROD run and the stage was stored
  without an error. It started `await_production_deploy` on its own, without the typed product
  code. One line under the buttons said why waiting came first and another why Deploy to PROD was
  blocked, when it was, and each button was described by its own line.
- The QA card did the same with **Wait for the release tag** after the module build's start, and
  **Wait for the QA deploy** after the QA deploy's, beside **Deploy to QA**, unless the build had
  ended: Jenkins had reported it failed, or it had released nothing holding its commit. Each
  started its wait stage on its own.
- A WAF workspace remote naming a user in an http or https address was refused with the new reason
  `user_in_remote`, worded in the settings' reasons; an `ssh://` remote kept its user.
- A module build that had not succeeded in time read "The build had not succeeded within N
  minutes."
