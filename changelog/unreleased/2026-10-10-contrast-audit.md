# The layout audit checks text contrast

- **Date:** 2026-10-10
- **Type:** feat
- **Scope:** `server`, `web`

While a scene is recorded (the scene video experiment), the layout audit now also finds text that
does not stand out from what is behind it. The minimum is WCAG's: 4.5:1, or 3:1 for text of 24px
and up.

What counts as behind the text is the nearest solid background colour of the text or its
containers, or every stop of a background gradient there, the worst one counting. A shape painted
behind the text by another element is not seen.

The finding joins the recording's check as a warning, and Compose again tells the agent to give
the text at least 4.5:1. In Chromium it flags grey on white, white on a light sky gradient and
yellow SVG text on white, and passes dark text on white and navy on the sky.
