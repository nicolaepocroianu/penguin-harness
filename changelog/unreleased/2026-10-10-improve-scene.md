# Improve a scene until it scores well

- **Date:** 2026-10-10
- **Type:** feat
- **Scope:** `server`, `web`

The Critique section of a scene video (the scene video experiment) has **Improve until it scores
4**. With the chosen agent, Penguin composes the scene again from its best version, records it and
critiques it, and goes round again until a critique scores it 4 or more, up to three rounds. Each
step appears in the run history as it happens. The first composition starts at once, so a refusal
shows straight away. The loop stops at the first step that does not succeed, and when the server
stops.

`POST .../improve-scene` takes `rounds` from 1 to 5 (3 by default), and refuses with
`improve_running` while the activity is already being improved. The idea is open-design's critique
loop, which repeats until the critique clears a bar.

On test16, rounds composed and critiqued by the Claude coding agent took scene 2 from 3.0 to 3.6
and then 3.8, with clean layout audits. The agent behind a round matters: the same loop with
GPT-5.3-codex composing went from 3.0 to 2.4.
