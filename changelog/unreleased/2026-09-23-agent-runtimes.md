# Coding agents: OpenCode, Copilot and Cline, session resume, and cancellation by signal

- **Date:** 2026-09-23
- **Type:** feature
- **Scope:** `coding-agents`, `server`

The coding-agents kernel now covers the agent runtimes Loom had hand-rolled clients for, taking its shape from Open Design's runtime adapters (a declarative table of agents, capability-driven resume, one process-tree kill) but keeping every agent on the Agent Client Protocol, so each tool approval still comes back to Penguin.

## New agents

- **OpenCode** (`opencode acp`), **GitHub Copilot CLI** (`copilot --acp`) and **Cline** (`cline --acp`) join Gemini, Claude Code and Codex in discovery. All three speak ACP themselves, so an installed CLI is immediately runnable with no adapter to add.
- OpenCode's own installer puts its binary in `~/.opencode/bin` without touching a server process's PATH; discovery now looks there.
- No agent is launched with a bypass or auto-approve flag.

## Resume

- A session can be reopened by the id its agent gave it, in the workspace it ran in: `POST /api/coding-agents/sessions/resume` with `agentId`, `workspaceDir` and `sessionId`.
- The agent decides whether it can. `session/resume` is used when advertised and continues without replaying history, recorded as a notice at the top of the transcript; `session/load` is used otherwise and the replayed conversation lands in the transcript. An agent offering neither is refused rather than handed a fresh session that has forgotten everything.
- Every session now reports `resumeSupport` (`resume`, `load` or `none`), from what its agent advertised at the handshake.
- Checked against the real CLIs on 2026-09-23: OpenCode 1.18 advertises resume and round-trips; Copilot 1.0.86 and Gemini CLI 0.49 advertise load.

## Cancellation

- `CodingAgentManager.prompt` takes an `AbortSignal`. Aborting it cancels the turn the same way the cancel route does; a signal that has already fired refuses the turn before anything reaches the transcript.
- The kernel's process-tree kill (`taskkill /T` on Windows, the process group elsewhere) is one exported helper, `killProcessTree`.
