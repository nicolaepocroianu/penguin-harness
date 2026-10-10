# The images stage is skipped, not failed, without an image provider key

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `server`, `web`

When the Media Agent's Vault has no `GEMINI_API_KEY`, the Stages sequence now skips the images
stage with a note saying so, as the sounds stage already does for a sound provider it cannot
use, and goes on to the assessment and the module, which reports the images missing. Before,
the whole sequence failed at the images stage, so an activity with any image could not be built
at all until the key was added.
