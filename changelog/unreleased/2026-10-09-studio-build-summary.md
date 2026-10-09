# The Module Definition at a glance

- **Date:** 2026-10-09
- **Type:** feat
- **Scope:** `web`

Module Definition opens on a summary, with a Summary | JSON toggle beside its title. The summary
shows the engine, the schema and specification versions, the theme names, and how many
module-wide assets and properties the definition declares. A table lists the files the
definition loads: each one's role, its URL, its type, and whether the module the preview plays
has it. A file in the module opens in a new tab. Each theme's properties follow as a list, with
long values clamped to two lines until "Show all". Cards for Configuration Data and Assessment
Data name their files and the assessment's item count, and open those sections.

The summary reads the document as it stands in the editor, so it follows unsaved JSON edits.
When the text is not valid JSON, it says why and offers the JSON view.

The JSON editors for Configuration Data, Assessment Data and Module Definition now wrap long
lines instead of scrolling sideways.
