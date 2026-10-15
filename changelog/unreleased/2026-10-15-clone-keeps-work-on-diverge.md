# A deploy that cannot bring main up to origin puts the authored work back

- **Date:** 2026-10-15
- **Type:** fix
- **Scope:** `server`, `web`
- **PR:** [#144](https://github.com/nicolaepocroianu/penguin-harness/pull/144)

Verifying the module and verifying media set the work in the module and media clones aside in
git's stash, brought main up to origin's, and put the work back. When origin's main had
diverged, or anything else failed after the work was set aside, the stage failed with the work
still in the stash, where nothing showed it and the next deploy left it out.

## Details

- After such a failure the clone goes back to the branch it was on and the work is put back as
  it was, what was staged staged again, before the failure is reported. This also happens when
  the deploy is stopped at that point.
- Work that conflicts with origin's changes stays in the stash, as before. Its stash message now
  reads "penguin-harness deploy: work set aside to bring main up to origin".
- Deploy readiness names a clone that holds work a deploy left in the stash, including stashes
  earlier versions left, as `clone_stash_left`. No stage starts until someone puts the work back
  or drops it by hand. The Deploy page shows it on the clone's row and in the problem list.
