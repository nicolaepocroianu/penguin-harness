# Scene assets read Saved when edits return to the saved manifest

- **Date:** 2026-10-16
- **Type:** fix
- **Scope:** `web`
- **PR:** [#159](https://github.com/nicolaepocroianu/penguin-harness/pull/159)

When an author's asset-editor edits ended back on the manifest already saved before the autosave's pause ran out (for example bind an image, bind another, clear, bind the first again), the pending save was dropped but the media save status stayed "pending", so the "Scene assets" status disappeared. The studio draft now settles a pending media save to saved once nothing is left to save, and the status reads "Saved". The script autosave has no pending state and was not changed.
