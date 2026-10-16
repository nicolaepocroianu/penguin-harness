# A module release's npm checks and stylesheet compile run confined, with none of the server's environment

- **Date:** 2026-10-16
- **Type:** fix
- **Scope:** `server`, `web`, `docs`
- **PR:** [#161](https://github.com/nicolaepocroianu/penguin-harness/pull/161)

A module release had run the module's own code in its clone unconfined and with the server's whole environment: verify_module's `npm ci`, `npm run buildDebug`, `npm run lint` and `npm run buildRelease`, and prepare_deploy's stylesheet compile. They ran instead in a check folder of Penguin's own, `activity-deploy/checks/<module>` in its data folder: made afresh from the commit they checked, holding no `.git`, and removed once they ended. While **Confine activity agents** is on, these programs started through the session sandbox in workspace-write mode, writable only in that folder, as a run module's preview build did since [the preview build change](2026-10-16-preview-build-confined.md). Confined or not, they started with only what Windows, Node and npm need. Every git call a deploy or the WAF workspace made ran no hook and no file-system monitor that a clone's own settings named.

## Details

- With the switch on and nothing able to confine, verify_module failed before its git work, and prepare_deploy failed before making the deploy branch when it had a stylesheet to compile, with the new stage error `sandbox_unavailable`; the log named the reason in the words an activity run is refused with. prepare_deploy with no stylesheet asked nothing of the sandbox.
- Both stages read the switch and the sandbox as they started, through `runConfinement`.
- `npm ci` kept the module's own `.npmrc`, took an empty npm user config of its own in place of the server user's `~/.npmrc`, and started with npm's proxy and certificate settings (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `NODE_EXTRA_CA_CERTS`) besides the short environment.
- `Clone.exportTo` wrote a commit's files into a folder outside the clone through an index of its own, with links as plain files, leaving the clone's index and working tree as they were. verify_module exported the commit it had just made of the authored module; prepare_deploy exported main's commit for the stylesheet compile. A stopped server's leftover folder was removed before each export, and the folder was removed after success, failure and Stop.
- Each run of the checks got a folder of its own (`mkdtemp`) under `activity-deploy/checks/<module>`; folders left there by a stopped server were removed first. An export removed a leftover index and its lock before it began.
- The compiled `res/style.css` was read only from a folder whose real path was inside the check folder, opened without following a link where the system allowed it, and only as a plain file with no other name. package.json, its lock and the stylesheet were written into the clone as new files renamed into place, into a folder whose real path was inside the clone.
- An assembled module's `.lfsconfig` was not copied into the clone.
- prepare_deploy made the deploy branch from main's commit, wrote package.json and package-lock.json from that commit's (`fileAt`) rather than from the disk, and took the compiled `res/style.css` from the check folder only when it was a plain file; nothing else in the folder reached the clone.
- A confined check's npm cache was `.npm-cache` in the check folder. verify_module still removed a `.npm-cache` folder from the module clone before committing the authored module, so one was never committed.
- Every git call through `spawnGit` started with `-c core.hooksPath=<the null device> -c core.fsmonitor=false -c protocol.ext.allow=never -c commit.gpgSign=false`. `gitEnv` always set `GIT_SSH_COMMAND`, an operator's `GIT_SSH` program quoted into it, so a repository's `core.sshCommand` never chose the SSH program.
- `Clone.push` ran `git lfs push origin <branch>` before the push when a `.gitattributes` in the branch sent files to LFS (`git grep filter=lfs`), the upload git-lfs's pre-push hook had made, whether or not a hook was installed. A partial clone's `git lfs install --local` still put git-lfs's hooks in the clone's `.git/hooks`.
- The stylesheet compile took the run-module path of the pinned Sass: a first install of it read the `.npmrc` every run's module is scaffolded with, not the clone's.
- `DeployProcess` took a `confine` option, passed to `runProgram`.
- git and Jenkins were not confined, and the module clone's git work kept its queue.
- The Skills page said how a release runs the module's code, in its check folder, what the release takes from it, that the checks can still read what the server can and reach the network, and what git no longer runs. In System settings, the explanation of **Confine activity agents** said that it also confines a module release's checks, in a folder of their own outside the clone, which can still read every file the server can and reach the network, and its no-sandbox status that module releases do not start their checks.
