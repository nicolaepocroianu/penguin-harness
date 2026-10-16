# A module release's npm checks and stylesheet compile run confined, with none of the server's environment

- **Date:** 2026-10-16
- **Type:** fix
- **Scope:** `server`, `web`, `docs`

A module release had run the module's own code in its clone unconfined and with the server's whole environment: verify_module's `npm ci`, `npm run buildDebug`, `npm run lint` and `npm run buildRelease`, and prepare_deploy's stylesheet compile. While **Confine activity agents** is on, these programs started through the session sandbox in workspace-write mode, writable only in the module clone, as a run module's preview build did since [the preview build change](2026-10-16-preview-build-confined.md). Confined or not, they started with only what Windows, Node and npm need.

## Details

- With the switch on and nothing able to confine, verify_module failed before its git work, and prepare_deploy failed before making the deploy branch when it had a stylesheet to compile, with the new stage error `sandbox_unavailable`; the log named the reason in the words an activity run is refused with. prepare_deploy with no stylesheet asked nothing of the sandbox.
- Both stages read the switch and the sandbox as they started, through `runConfinement`.
- `npm ci` kept the module's own `.npmrc`, took an empty npm user config of its own in place of the server user's `~/.npmrc`, and started with npm's proxy and certificate settings (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `NODE_EXTRA_CA_CERTS`) besides the short environment.
- A confined check's npm cache was `.npm-cache` in the module clone. verify_module removed that folder before committing the authored module and again after its checks, so it was never committed and never left behind.
- The stylesheet compile took the run-module path of the pinned Sass: a first install of it read the `.npmrc` every run's module is scaffolded with, not the clone's.
- `DeployProcess` took a `confine` option, passed to `runProgram`.
- git and Jenkins were not confined, and the module clone's git work kept its queue.
- The Skills page said how a release runs the module's code. In System settings, the explanation of **Confine activity agents** said that it also confines a module release's checks, and its no-sandbox status that module releases do not start their checks.
