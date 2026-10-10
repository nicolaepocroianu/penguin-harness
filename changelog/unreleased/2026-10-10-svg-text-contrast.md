# SVG text is measured against the shape under it

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `activities`

The layout audit measured SVG text against the nearest CSS background, so dark letters on a pale
stone over a dark sky were reported as hard to read. Every composing round was then told to fix
text that was fine. SVG text is now measured against the last solid shape drawn before it in its
SVG, under its middle; text without such a shape is measured as before.
