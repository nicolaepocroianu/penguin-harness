# The layout audit checks margins and gaps

- **Date:** 2026-10-10
- **Type:** feat
- **Scope:** `activities`

While a scene is recorded, the layout audit now also finds:

- a main object inside the stage but closer than 16px to its edge (`near_edge`);
- two main objects that do not cover each other but are less than 12px apart (`crowded`), under the
  same exceptions as covering.

Both show in the video's final check as warnings, and composing the scene again hands them to the
agent as fixes. The scene composition skill names the 12px gap. Critiques of test16 asked for both
round after round, with layout the lowest score.
