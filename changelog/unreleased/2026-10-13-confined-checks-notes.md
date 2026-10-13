# The server's own re-tests name what their confinement does not stop

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `server`
- **PR:** [#135](https://github.com/nicolaepocroianu/penguin-harness/pull/135)

These are the checks the server runs itself when a test run reuses earlier tests (see
[server-run re-tests](2026-10-13-server-run-retests.md)). The comment at the top of their code now
names the limits of what confines them:

- The child process can reach the server's own loopback API, though only as an unauthenticated
  caller.
- The page is same-origin with the play link, so it can reach every route on that host and port
  that needs no sign-in.
- The test file can forge its own results over the IPC channel. The protection covers the
  harness, the runner and the input, not the agent's own test file.

## Details

- When the checks could not run, the reason now comes first from the failure the child itself
  sends over IPC. A "could not run" line on stderr is used only after that, since a check could
  print one to look like the runner.
- The child is now given only what Node needs: `PATH`, `TEMP`/`TMP` (`TMPDIR` elsewhere),
  `SYSTEMROOT` and `WINDIR`. `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA` and the rest of the
  earlier list are no longer passed. On Windows, process spawning still adds a fixed few of its
  own, the user's name and profile folder among them; the child may not read any folder they
  name.
