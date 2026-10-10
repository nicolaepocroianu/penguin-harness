# The player check no longer starts every activity paused

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `server`

The test browser now starts with `--autoplay-policy=no-user-gesture-required` wherever it plays
an activity: the module stage's player check, acceptance tests, quality checks and scene video
recordings. Headless Chromium kept audio from starting until a person tapped the page, so the
WAF framework paused every activity "for audio recovery" and its pause overlay took every tap.
Each module looked stuck at its first choice, and module agents spent 10 to 20 minutes trying to
work around it in module code. The harness API also tells agents that a Chromium they launch
themselves needs the same flag.
