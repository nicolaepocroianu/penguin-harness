# Captions stay up long enough to read

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `activities`

A scene video's captions used to disappear as their last word ended, so a one-word caption showed
for about a quarter of a second, and captions a moment apart flickered off and on. Each caption now
shows for at least 1.2 seconds and runs on to the next when they are under half a second apart. It
never overlaps the next caption or runs past the end of the video.
