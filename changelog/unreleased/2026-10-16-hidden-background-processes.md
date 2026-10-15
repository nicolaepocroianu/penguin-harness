# Background programs no longer open console windows on Windows

- **Date:** 2026-10-16
- **Type:** fix
- **Scope:** `server`, `core`, `cli`, `desktop`, `plugins`

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
- A test in core reads every package and plugin, and fails when a `child_process` call does not
  pass `windowsHide: true`. It follows aliases such as a promisified `execFile` or an injected
  `spawn`. Three spawns are meant to be seen and are listed in the test: showing a file in the
  file manager, opening the browser, and the shell `penguin config lang` opens.
- Nothing changes on macOS or Linux, where the option is ignored.
