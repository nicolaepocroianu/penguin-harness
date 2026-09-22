# Quick Switcher (Ctrl/Cmd+K) for pages, coding agents and their sessions

- **Date:** 2026-09-22
- **Type:** feature
- **Scope:** `web`
- **PR:** pending

The Web App gained a keyboard-first command palette: Ctrl/Cmd+K opens a search overlay
from anywhere in the app shell, listing the main-nav pages, the configured coding agents,
and the coding-agent sessions (with each session's agent and live busy/idle state).
Selecting an entry navigates to it and closes the palette.

## Details

- Matching is case-insensitive and ranks an exact title match above a title prefix, a
  substring, a hit in the row's secondary text (an agent's command, a session's agent),
  and finally a fuzzy subsequence; results stay grouped into Pages / Coding agents /
  Sessions sections. With an empty query the most recent selections surface first,
  followed by the pages.
- Recent selections are remembered per browser in localStorage
  (`penguin.quickSwitcher.recents`), most recent first, capped at five.
- Keyboard: ArrowUp/ArrowDown move the selection with wraparound, Enter opens, Esc
  closes, and the selection auto-scrolls into view; mouse hover selects and click opens.
  The chord is ignored while focus is inside the docked terminal, which keeps Ctrl+K for
  the shell.
- A session entry opens the coding-agents page with that session preselected (route
  state, read once as the initial selection).
- The coding-agent and session lists are fetched only when the palette opens, not at app
  boot; pages come from the module manifest with the sidebar's released and admin
  visibility rules.
