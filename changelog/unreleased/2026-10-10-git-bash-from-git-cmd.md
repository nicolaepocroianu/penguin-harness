# Agents get Git for Windows' bash when only git is on PATH

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `core`

On Windows, the shell an agent's commands run in is now Git for Windows' bash whenever Git for
Windows is installed, including the installer's default setup, which puts only its `cmd` folder
(holding `git`, not `bash`) on PATH. Such machines used to fall back to PowerShell. The skills
and prompts agents follow are written for bash, so agents kept writing bash commands that
PowerShell could not parse (`<<` heredocs, `$` inside strings), and each one cost a failed turn.
The bash is found in the `bin` folder of the install that `git` resolves into; it still comes
after a `bash` already on PATH and before the bundled MinGit shell, and `PENGUIN_SHELL` still
overrides it.
