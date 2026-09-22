# Coding agents run as ordinary Sessions: listed, traced and reopened

- **Date:** 2026-09-23
- **Type:** feature
- **Scope:** `coding-agents`, `server`

A coding agent (Claude Code, Codex, OpenCode, Copilot, Cline, Gemini or a saved ACP agent) now runs as a Penguin Session like any other: created by picking a `coding-agent` model, filed under the Penguin Agent it was started from, listed in that Agent's sessions, recorded in the Session's Trace, and reopened after its entry is dropped or the server restarts.

## How it works

- Creating a Session with provider `coding-agent` and `modelId` naming the agent (`codex`), optionally with one of its models (`codex::model::gpt-5`), opens the agent's own session in the chosen workspace, or in a new temporary one under the Penguin Agent, and applies that model. A model the agent refuses fails the creation rather than falling back silently.
- Each turn is one request in the Trace: the user's message, `request_begin`, the agent's text, thinking and tool calls with their output, then `request_end`. The Trace is written with core's own writer, in the same directory and format as every other Session's; streamed partials are shown live and not recorded, exactly as for core Sessions.
- The agent's permission asks go through the Session's approvals. The approval mode applies (allow-all lets the agent act, always-ask waits for a person, read-only allows only reading, searching and fetching tools), asks appear as ordinary approval cards, and each decision is recorded as `approval_decision` and passed back to the agent as its matching allow or reject option.
- A Session remembers its agent session in the agent's home (`coding-agents/<agent>/sessions/<session>.json`). Reopening resumes that agent session when the agent can; when it cannot, or has lost it, the Session continues in a fresh agent session and the transcript says so. Either way the Trace carries on in the same file.
- The Project's model list now also returns `codingAgentModels`: one row per agent that can start a Session, plus one per model it advertised. They are kept apart from `models`, so they are never saved into the Project's model table, synced to a machine, or set as the default or vision model.

## Limits

- ACP reports how full an agent's context is, not what each request cost, so these Sessions record no token usage and carry no cost.
- Compaction and steering are the agent's own business; neither is offered for these Sessions. The title is the first message's fallback title, since no title model runs.
