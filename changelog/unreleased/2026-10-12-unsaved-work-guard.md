# Unsaved work registers itself with one guard

- **Date:** 2026-10-12
- **Type:** fix
- **Scope:** `web`
- **PR:** [#112](https://github.com/nicolaepocroianu/penguin-harness/pull/112)

The activity studio got one unsaved-work guard (`unsaved-work.ts`, with
`unsaved-work-context.tsx`). An editor holding unsaved work now registers it with
`useHeldWork`, and every place that would throw work away asks the guard first:

- switching section
- leaving the activity's route
- unloading the page
- changing Project
- reloading the draft
- using a candidate specification

A scene video's unsaved timeline edits used to be lost without a word when the author left
the scenes, the activity or the Project. The timeline editor now registers its edits, so
leaving asks first.

## Details

- The studio draft and the module document editors registered their own unsaved work. The
  `onDirty` prop chain, `SELF_HELD_SECTIONS` and `sectionSwitchDiscards` were removed.
- `resolveSection` keeps a section open while its own editor holds work.
- The page's two discard dialogs and the host's one became a single dialog in the activities
  host. It keeps the same title, buttons and texts: the section text for a section switch, the
  draft text otherwise.
- `use-discard-confirm.tsx` was removed.
- Node tests of the guard were added. The section-switch tests of `workspace-model` were
  replaced by them.
- An end-to-end check was added: leaving the scenes with an unsaved timeline asks first, and
  declining keeps the edit.
