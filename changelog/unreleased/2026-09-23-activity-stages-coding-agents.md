# Activity stages can run on an external coding agent

- **Date:** 2026-09-23
- **Type:** feature
- **Scope:** `coding-agents`, `server`, `web`

Generating a specification, assembling a module and improving media text can now run on an external coding agent (Claude Code, Codex, OpenCode, Copilot, Cline, Gemini, or any saved ACP agent) instead of a Penguin agent. The Generation agent picker on the activity editor lists both, grouped; the choice is per run.

## How a run works on a coding agent

- The stage routes (`generate-spec`, `assemble-module`, `generate-media-text`) take `codingAgentId` in place of `agentId`; exactly one is required.
- The run opens an ACP session in its own workspace, sends the same prompt a Penguin agent would get, and collects the same output files. The agent's turn end stands in for the idle Session that collection otherwise waits for.
- An agent that stops short fails the run with its own reason (it refused, ran out of output, hit its request limit, lost its connection), not a missing-file message.
- Cancelling the run cancels the agent's turn.
- The run records `codingAgentId`, and its `sessionId` is the agent's own session id. The history links to that session on the coding-agents screen, where its transcript stays readable and, for an agent that supports it, it can be reopened.
- Speech and image generation stay on Penguin agents: both call Gemini through a helper that reads the key from a Penguin agent's Vault, which an external agent's process never sees. Those buttons are disabled while a coding agent is selected, with a note saying why.

## The shared WAF checkout

- A coding-agent session can be given protected folders. Any permission ask whose reported locations, or whose raw input under a path-like key, fall inside one is refused before anyone sees it, with a notice in the transcript naming the path and the folder.
- A module assembly on a coding agent protects the WAF checkout this way.
- This is a check on asks, not a confinement. An agent running in a mode that edits without asking, or naming a path only inside a shell command, is not caught; the checkout's full protection still depends on the sandbox, as it does for Penguin agents' shell commands.
