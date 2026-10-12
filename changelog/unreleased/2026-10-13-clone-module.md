# Deploys and the WAF workspace talk to git through one Clone module

- **Date:** 2026-10-13
- **Type:** refactor
- **Scope:** `server`

The deploy stages, the deploy context, media publishing and the WAF workspace stopped writing git command lines of their own and went through `packages/server/src/activities/clone.ts`. A `Clone` speaks of a clone in domain terms: what it looks like, which branches it and origin have, putting it on a branch as origin has it, staging, committing, pushing, tags, and the sparse folders a media clone checks out. `Clones` makes clones, starts new repositories and asks whether a remote exists. The command lines, the batching of long path lists, the parsing of what git prints and the three ways a clone was put on a branch as origin has it (carrying authored work, discarding the deploy's own clone, switching a clean shared clone) moved behind it, on top of `run-program.ts`.

## Details

- `DeployPorts.runGit` and `WafWorkspacePorts.runGit` were replaced by `clones`. Tests answer at the Clone level with a shared fake (`test/fake-clones.ts`). What git itself does is tested against real repositories in `activity-clone.test.ts`.
- `cloneState`, `localBranchExists`, `remoteBranchExists`, `sparsePathPresent`, `branchState` and `gitAvailable` left `deploy-git.ts`. `repositoryMissing` and `gitError` moved from `waf-workspace.ts` to `clone.ts`.
- The workspace's repository status and the deploy context read a clone's branch the same way (`rev-parse --abbrev-ref HEAD`).
- Adding a product's media folder followed the deploy context's rule: a folder that a sparse folder already holds is not added again, and a media clone that is not sparse has nothing to add.
- Deploy log lines, stage failures, HTTP responses and error messages kept their wording. One exception: in a new module's first deploy, the line "No commit yet: the new module's work stays in place." now appears after the git commands that keep the work in place, not before them.
