# A layout audit of each recorded scene

- **Date:** 2026-10-10
- **Type:** feat
- **Scope:** `server`, `web`

While a scene composition is recorded (the scene video experiment), Penguin now measures its
layout at five moments, from the first frame to the last. It reports:

- two of the scene's main objects covering each other;
- a main object reaching outside the stage;
- visible text smaller than 28px. SVG text is measured by its size on screen.

The agent marks the main objects with `data-focal`, and anything meant to sit over another with
`data-allow-overlap`; the composition prompt now asks for both. Elements too faint to see are
not measured.

The findings join the recording's final check as warnings, naming the elements and when they
were seen. For example: "#chest and #palm cover each other, seen from 0 s to 11.5 s." A page
that breaks the measuring script is simply not measured there; the recording still comes out.

The idea follows HeyGen HyperFrames' `check` command (Apache-2.0); this is Penguin's own, smaller
version.
