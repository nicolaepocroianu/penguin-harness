# The activity studio says things plainly

- **Date:** 2026-10-15
- **Type:** feature
- **Scope:** `web`, `server`
- **PR:** pending

Phase 1 of the Activity Studio audit. The rail, the section titles and the page headings now use
one word per thing, the glossary's, in sentence case. Rows lead with the words an author wrote
rather than with asset keys. A video bound to the shared placeholder says Placeholder instead of a
green Bound, and the header counts placeholders apart from real files. Lists mark only what needs
something.

## Details

- **Names.** The rail reads Script, Specification, Features, Storyboard, Audio, Library, Module,
  Configuration, Assessment, Deploy, Stats and History. Each section's page heading matches its
  rail row: "Speech coverage" became Audio, "Media library" became Library, and History gained a
  heading above Versions, Module builds and Runs. Copy that named a section, such as "Each stage
  is an ordinary run in Generation History", now uses the new name. "Save Spec" became "Save
  specification" and the header's Spec step became Specification.
- **Section titles.** The Specification, Module, Configuration and Assessment editors are titled
  by their section's name only. The "<title> - <product> [<ref>]" suffix is gone; the header
  already names the activity and its ref.
- **Rows.** An Audio row leads with the line's words, and a Sounds row with the sound's
  description. The key and the scenes follow on a second line, with the key in mono. A Library
  row leads with the asset's description, with its key in mono underneath.
- **Placeholder.** The server names the paths it binds videos and animations to until a real file
  replaces them, through `GET /api/projects/:projectId/activities/:activityId/media-placeholders` (`placeholderPaths()` in
  `media.ts`, built on the `placeholderPath()` that seeds them). The studio compares each binding
  with those paths and never with a file name. A placeholder binding shows Placeholder in the
  attention tone in the asset editor, the Library, the specification's scenes, the script's clip
  chips and the rail. The header's Media step reads "30 ready · 8 placeholders" and the script's
  status bar counts placeholders apart. Placeholders mark the Media step but do not become the
  Next step: an activity often goes to QA with them. No stored data changed.
- **Marks.** An Audio or Sounds row with a file says nothing, and the summary says "All 30 lines
  have audio" once. Only a scene that differs from the script is marked, and "All match the
  script" is said once above the scenes. A deploy stage that has not run shows a hollow mark
  instead of "Not run"; the words stay for screen readers. An assessment choice's Remove button
  shows on hover or keyboard focus, and always on a phone.
- **Header.** A done step in the header (Script saved, Specification validated, Module built)
  is said by its filled dot. Its words stay for screen readers and show on hover. This keeps
  the longer Specification label and the placeholder count on one row at 1440 px.
- **Loading.** While an activity loads, the studio draws a skeleton shaped like the section being
  opened: an editor's lines, a list's rows, the storyboard's cards or Deploy's stages. It replaces
  the "Loading…" line that sat in the window's corner.
- **House rules.** The rail and the panel chips use the `text-xs` rung instead of `text-[13px]`,
  `text-[11px]` and `text-[10.5px]`. Their icons use rungs from `icon-scale.ts`. The canonical
  ref's star on the activity list is drawn through `GlyphIcon`.
- **Tests.** Unit tests were added for the placeholder paths, the Library's placeholder source,
  the rail's placeholder mark, the script's placeholder count and the header's Media step. The
  activities e2e uses the new section names.
