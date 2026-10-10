# Compose again fixes what the last recording got wrong

- **Date:** 2026-10-10
- **Type:** feat
- **Scope:** `server`

When a scene is composed again (the scene video experiment), the agent is told what the final
check of the asset's newest recording found, and asked to fix each one. The findings go into the
composition's input as `previousRecordingFindings`, worded as instructions, such as "#map and
#palm-left cover each other from 0 s to 9 s: move them apart, or mark the one meant to sit over the
other with data-allow-overlap." This covers:

- main objects covering each other or leaving the stage;
- text that is too small;
- black picture;
- a timeline that runs a different length from its frames.

Findings a composition cannot change are left out. Finished videos rendered from a timeline are
never what this reads.
