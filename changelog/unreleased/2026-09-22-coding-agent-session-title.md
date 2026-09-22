# Coding-agent sessions can be renamed

- **Date:** 2026-09-22
- **Type:** feature
- **Scope:** `coding-agents`, `server`, `web`
- **PR:** pending

Coding-agent sessions carried only their opaque agent-issued ids. They now take a display title: a rename action in the session view's header opens a small dialog, and the title replaces the default "agent — workspace" label in the sessions list, the session view header, and the transcript export's H1.

## Details

- `PATCH /api/coding-agents/sessions/:sessionId` accepts `{ title }`, trims it, caps it at 120 characters, and answers with the updated session; an empty title clears the rename back to the default. Titles live in memory with the session itself — they end when the session does, like every other part of a coding-agent session's state.
- The sessions list row and the session view header show the title when one is set and the agent-and-workspace label otherwise; a pencil action next to the header title opens the rename dialog.
