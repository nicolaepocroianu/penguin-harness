# Background programs no longer open windows

- **Date:** 2026-10-16
- **Type:** fix
- **Scope:** `server`, `core`, `cli`, `desktop`, `plugins`
- **PR:** [#154](https://github.com/nicolaepocroianu/penguin-harness/pull/154)

On Windows, a Penguin with no console of its own (the desktop app, or the server `penguin`
starts in the background) opened a console window for every program it started without hiding
it. With Windows Terminal as the default terminal, that window also took focus from whatever the
user was doing. Checking for an update did it, and so did hook scripts, connections to remote
machines, the MXC sandbox's check, and adding `penguin` to PATH from the desktop app.

All of them now start hidden. The agent CLI checks (versions, sign-in, Test, Rescan) and the
agents themselves already started hidden, and still do.

## Details

- Now hidden: the update run (`penguin update --yes`, started by the Web App's update), hook
  scripts, ssh, scp and tar to remote machines and the held ssh session, the MXC sandbox's
  `--probe`, the desktop app's `reg` calls, the server `penguin` starts in the background, the
  server under `penguin serve`, and the package manager `penguin update` runs.
- On macOS and Linux these programs already ran out of sight, and still do: a child process
  gets no window or terminal there, nothing starts a terminal emulator, and agent checks and
  sessions run with `NO_BROWSER=1`.
- Under the desktop app, the update run starts the CLI with `ELECTRON_RUN_AS_NODE`, on every
  platform. Without it, a call to the update endpoint would start a second copy of the app. The
  app's own window updates through the desktop updater, so this was reachable only through the
  API.
- A test in core reads every package and plugin and fails in two cases. One is a
  `child_process` call that does not pass `windowsHide: true`; the test follows aliases such as
  a promisified `execFile` or an injected `spawn`. The other is a file that starts a program
  meant to show something (`open`, `xdg-open`, `osascript`, Explorer, a terminal emulator) and
  is not on the test's list. Three spawns are meant to be seen: showing a file in the file
  manager, opening the browser, and the shell `penguin config lang` opens. So is the desktop
  app's macOS administrator prompt for installing `penguin`.
