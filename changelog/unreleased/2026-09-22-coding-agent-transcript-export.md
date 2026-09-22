# Coding-agent sessions export their transcript as Markdown

- **Date:** 2026-09-22
- **Type:** feature
- **Scope:** `coding-agents`, `server`, `web`
- **PR:** pending

The coding-agent session view gained an Export transcript action that downloads the session as a Markdown document: an H1 naming the agent, a metadata block (agent, session id, created time, workspace, model), then the conversation in order — prompts as `## User` sections, the agent's text and thinking as `## Agent` sections, tool calls as list items carrying their latest status.

## Details

- The download rides a new `GET /api/coding-agents/sessions/:sessionId/transcript` route (`text/markdown; charset=utf-8`, `Content-Disposition` attachment named `penguin-coding-agent-<sessionid>.md`), built from the same in-memory session state and bounded event log the detail route serves, so the document cannot drift from what the session view shows. Connection noise (state changes, usage, config/mode bookkeeping, permission plumbing, turn markers) does not render.
- The event log gained a `user_message` entry: a prompt is now recorded when its turn starts, so the transcript shows both sides of the conversation in the order they happened. It flows to the session stream like any other event.
- Thinking runs render as blockquotes, agent notices as italic lines, and a tool call sits at its first sighting while later updates refresh its status line in place.
