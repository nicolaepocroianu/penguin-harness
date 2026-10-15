# Previews of a run's module build confined, with none of the server's environment

- **Date:** 2026-10-16
- **Type:** fix
- **Scope:** `server`, `web`, `docs`
- **PR:** [#158](https://github.com/nicolaepocroianu/penguin-harness/pull/158)

Building a module run's module for its preview (the play page, the Play button's build, and the player check a run's agent loads) had run the module's own `npm run build` or `buildDebug` and its stylesheet compile on the server unconfined, with the server's whole environment. While **Confine activity agents** is on, both programs started through the session sandbox in workspace-write mode, writable only in the module's folder, as the run's agent's own commands were. Confined or not, they started with only what Windows, Node and npm need (`PATH`, `PATHEXT`, the temporary folder, `HOME`/`USERPROFILE`, `APPDATA`/`LOCALAPPDATA`, `SystemRoot`, `SystemDrive`, `windir`, `ComSpec`).

## Details

- With the switch on and nothing able to confine, a build of a run's module was refused with 409 `sandbox_unavailable` and the message an activity run gets in the same case; the play page answered 409 with it. A module already built kept playing.
- A program the sandbox would not confine did not start, and the build failed naming the reason.
- An install of the pinned Sass that a run module's stylesheet compile waited for read the `.npmrc` every run's module is scaffolded with, not the module's own, and started with the same short environment plus npm's proxy and certificate settings (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `NODE_EXTRA_CA_CERTS`).
- A confined build's npm cache moved to `.npm-cache` in the module's folder. A deploy no longer copied that folder into the module's clone, and a module build's file list and comparison left it out.
- Activity runs and run builds shared one refusal (`run-sandbox.ts`).
- `runProgram` took a `confine` step: the argv it would spawn, through cmd.exe for a Windows `.cmd` wrapper, is rewritten by the confiner. A cmd.exe line needing quotes of its own was refused rather than passed through a runner's quoting.
- Builds of a module from the WAF checkout, and a deploy's programs, were not changed.
- The Skills page said how a run module's preview is built. In System settings, the explanation of **Confine activity agents** said that it confines that build too, whichever agent the run had, and its no-sandbox status said that such previews do not build.
