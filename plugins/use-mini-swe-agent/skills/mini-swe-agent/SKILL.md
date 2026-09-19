---
name: mini-swe-agent
description: Delegate a bounded coding task to mini-swe-agent in an explicit repository, using a provider model and saving its trajectory for review.
---

# mini-swe-agent

## Before you start

If the message only names this skill, ask which repository and coding task to work on.
Otherwise proceed with the supplied task. Resolve the repository, model, provider credentials,
and allowed budget from the conversation and environment; ask only for missing requirements.

This plugin runs the upstream Python agent as a child process. Install it from Penguin's
plugin library on the agent that should delegate coding work. It is not preinstalled.

## Prepare the run

- Use Python 3.10+ and `uv`. The bundled runner pins mini-swe-agent 2.4.6 through its script
  metadata; `uv run` installs it in an isolated environment on first use.
- Run in a POSIX environment (Linux, macOS, or WSL on Windows). The upstream prompts assume
  POSIX shell commands. On Windows, run both Python and the repository checkout inside WSL;
  pass Linux paths, not Windows paths.
- Use an isolated Git worktree for independent work. This is workspace separation, not a
  security sandbox. The child can execute arbitrary shell commands with the launching user's
  permissions. Run inside the project's configured sandbox when confinement is needed.
- Choose an explicit mini-swe-agent model identifier, such as `openai/gpt-5`, and supply its
  provider credentials through environment variables (Penguin's vault can inject these).
  Penguin's selected model, AgentHub authentication, tools, and per-command approvals are
  not automatically forwarded to this independent agent. Do not print credentials or place
  them in the task or command arguments.
- Write the task, acceptance criteria, applicable repository instructions, and scope into a
  UTF-8 task file. Tell the child to leave the changes for review, without committing,
  pushing, publishing, or contacting others unless the user requested those actions.

## Invoke

Resolve `scripts/run.py` relative to this installed SKILL.md. Use absolute paths for the
runner, repository, task file, and a fresh output directory. For example, in a POSIX shell:

```sh
uv run /absolute/skill/scripts/run.py \
  --cwd /absolute/worktree \
  --task-file /absolute/task.txt \
  --model openai/gpt-5 \
  --output-dir /absolute/runs/unique-run \
  --cost-limit 3 --step-limit 50 --time-limit 900
```

The runner uses upstream `DefaultAgent`, avoiding the interactive CLI's first-run setup and
confirmation prompts. It writes `trajectory.json` after steps and `result.json` on completion.
The output directory must not already exist. Limits must be positive; the cost limit is
checked between model calls and may overshoot by one call. The time limit is also checked
between calls, not a hard process deadline. Track the command session until it exits; cancel
through the host's process controls if needed and check for remaining child processes.

## Review the result

Exit code 0 means the upstream agent submitted, not that its patch is correct. Exit code 1
means it stopped without submitting (for example, a limit); an exception also fails the run.
Inspect `result.json` for `exit_status`, `submission`, cost, and call count. Inspect
`trajectory.json` for details; it can contain source code and command output, so keep it
local unless the user requests sharing it. An interrupted run may only have a trajectory.

Review `git diff` in the worktree and run the task's relevant checks yourself. Report changed
files, verification, and remaining failures to the user. Do not retry a limit failure with a
larger budget without authorization. Each invocation starts a new conversation; to follow up,
keep the worktree, write a new task explaining the remaining work, and use a new output directory.

Upstream: [repository](https://github.com/SWE-agent/mini-swe-agent),
[Python API](https://mini-swe-agent.com/latest/advanced/cookbook/).
