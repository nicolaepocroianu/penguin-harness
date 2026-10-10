# Compose again builds on the best version

- **Date:** 2026-10-10
- **Type:** feat
- **Scope:** `server`

Composing a scene again (the scene video experiment) no longer starts from a blank template. The
agent is given the best version so far as `previous-composition.html`, with its frames as
`previous-frames.json`. That is the composition whose recording a critique scored highest, or the
newest composition when none was critiqued. The agent is told to start from it, keep what works,
and change only what the findings ask for.

The findings handed over are that version's own:

- what its recording's check and layout audit found;
- what its source's lint found;
- the critique's four most important fixes.

On test16, each round that redrew the scene from scratch to apply eight fixes at once scored lower
than the last (3.8, then 3.4; 3.0, then 2.2). Each redraw broke something that had worked.
Building on the best version and asking for fewer fixes at a time is open-design's ratchet, which
keeps its best round.
