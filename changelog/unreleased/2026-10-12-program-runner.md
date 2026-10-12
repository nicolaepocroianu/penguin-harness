# One module runs every activity child process

- **Date:** 2026-10-12
- **Type:** refactor
- **Scope:** `server`

The activities' seven hand-written child-process wrappers (deploy git, deploy npm/npx, the module build and Node build scripts, media helper runs and their npm installs, FFmpeg, the test browser's installer and lookup, espeak-ng), and with them the module builder's pinned-Sass install and compile, were moved onto one module, `packages/server/src/activities/run-program.ts`. It owns the spawn options, cmd.exe and its quoting for Windows `.cmd` wrappers, the time limit, the abort signal, the tree kill, the bounded output and line streaming, and reports one outcome: `exited`, `not_found`, `timed_out`, `stopped` or `failed_to_start`. Each caller maps that outcome to the shape it already returned.

## Details

- `stopTree` and `clampLog` moved out of `sandbox-build-runner.ts` into the new module; deploy code no longer imports a sandbox file.
- An FFmpeg run past its time limit, or killed by its caller, was stopped together with anything it started; before, only FFmpeg itself was signalled.
- A missing program was recognised the same way for every caller: the spawn's ENOENT, the exit codes 127 and 9009, and, for npm and npx on Windows, a PATH lookup before cmd.exe runs (cmd.exe exits 1 for a command it cannot find). A missing working folder was reported as a failure to start rather than a missing program.
- On Linux and macOS each program led its own process group, so a stop or timeout reached its grandchildren; groups still running when the server exits are killed with it.
- npm and npx on Windows received their arguments quoted for cmd.exe instead of joined with spaces.
- A deploy's npm and npx output reached the deploy log a whole line at a time, per stream.
- Output limits were kept: git 64 KiB per stream, deploy programs 8 KiB, builds 256 KiB, media helpers and the browser installer 64 KiB, FFmpeg's stderr 4 000 characters (32 MB for reports), espeak-ng 64 KiB. A build or install log cut short now counts every omitted character.
