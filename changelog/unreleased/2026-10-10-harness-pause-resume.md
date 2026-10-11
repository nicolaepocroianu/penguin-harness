# Player checks can pause and resume the activity

- **Date:** 2026-10-10
- **Type:** feat
- **Scope:** `server`

The acceptance harness gains `activity.pause()` and `activity.resume()`. They press the
player's pause key (Shift+P), as a learner would, and wait for the framework's pause overlay to
show and to go. The module stage's player check asks for pause and resume, but the harness had
no way to do either: test19's agent skipped the check as "not exposed in this player build", and
test18's published made-up events that paused nothing, so its check passed without testing
anything. The harness version is now 2, so tests written against version 1 are written again
rather than reused.
