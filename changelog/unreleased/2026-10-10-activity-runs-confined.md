# Activity runs confine their commands to the run's workspace

- **Date:** 2026-10-10
- **Type:** feature
- **Scope:** `core`, `sandbox`, `activities`

An activity run's own agent now runs its commands confined to the run's workspace. Everything
else, including the WAF checkout, is read-only to those commands. Before, only the file tools
were held off the checkout; a command the agent ran could still write anywhere. The
deployment's sandbox setting does not change: other Sessions run exactly as before.

## Behaviour

- A Session can be created with a confinement floor (`sandboxMode`: `workspace-write` or
  `read-only`). Its commands run at least that confined. A stricter deployment setting still
  wins, and the deployment's network and path masking still apply.
- Activity runs that use a Penguin agent are created with `workspace-write`. A run reopened
  later in chat stays confined.
- An activity run that nothing can confine is refused before it starts, with a message to enable
  a sandbox plugin for the project (`sandbox-dsh` works on Windows, macOS and Linux). Nothing is
  recorded for it.
- A confined Session's npm keeps its cache in the Session's workspace, the only place its
  commands can write, so `npm install` still works there.
- On Windows a confined Session runs its commands in PowerShell (PowerShell 7 where installed),
  and its system prompt says so. Git Bash cannot start inside a Windows sandbox. A `PENGUIN_SHELL`
  naming PowerShell or cmd is still honoured. Linux and macOS keep bash.
- A confined run's player check and acceptance tests connect to a test browser that Penguin starts
  for the run and stops when it ends. Its own commands cannot start Chromium inside a sandbox. The
  browser listens on the loopback address only, and the checks reach it through Playwright's own
  protocol.
- Git Bash is started by its full path on Windows. A sandbox looks in the Windows system folder
  first, where a bare `bash` is the WSL launcher.
- A subagent is held to its parent's limits: the same confinement floor and the same protected
  folders. Before, a subagent of an activity run could write to the checkout through its file
  tools.
- Runs on a coding agent are not changed. A coding agent runs its own commands, outside
  Penguin's sandbox. Local audio models run no agent and are not refused either.
