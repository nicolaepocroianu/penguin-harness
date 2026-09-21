# A full-height workspace for authoring an activity

- **Date:** 2026-09-21
- **Type:** refactor
- **Scope:** `web`
- **PR:** [#34](https://github.com/Prism-Shadow/penguin-harness/pull/34)

The activity editor was one long page: description, generation, scenes, media, module
preview and history stacked down a single scroll, with the scene tree squeezed into a
256-pixel box inside the media section. It is now a workspace that fills the window, with
a rail for the parts of an activity and a detail pane that scrolls on its own.

## The layout

The page fills the shell's main area and never scrolls the document. A pinned header
carries the activity, its save state and the reload action. Below it, a rail lists the
parts of an activity: Description, Specification, Scenes and media, Speech coverage,
Media library, Module preview and Generation history. The scene tree nests under Scenes
and media. The rail scrolls independently of the detail pane beside it.

The rail can be collapsed, and the divider between it and the detail pane can be dragged
or moved with the arrow keys, Home and End. Its width and collapsed state are remembered
per browser. On a window too narrow to hold both, the rail gives way rather than squeezing
the detail pane below the width its two-up comparison needs.

## The detail pane

The scene asset editor became its own pane with a pinned header naming the asset and its
scene, a scrolling body, and the binding and its save action pinned to the bottom, so the
primary action is never scrolled out of reach.

## Details

- A section whose subject does not exist yet stays visible and disabled rather than
  disappearing, so an activity does not look like it has fewer parts than it does.
  Scenes and media is the exception: it is always reachable, because the action that
  builds the media plan lives inside it.
- `features/activities/workspace-model.ts` holds the section list, the selection rules
  and the width arithmetic as pure functions, covered by
  `packages/web/test/activities-workspace-model.test.ts`.
- `/activities` joined the browser sweep that asserts no page grows the document. That
  sweep could not run at all: it waited on a Chinese sidebar label the app stopped
  shipping when the translations were removed, so the label was brought back to English.
  The rest of that file still drives the app through labels it no longer ships, and
  repairing those is left to its own change.
- The asset manifest disclosure became controlled state, like the specification's, so
  moving between sections no longer closes it.
- Reload draft moved to the workspace header and is no longer repeated in the
  description block.
- The detail route no longer wraps the workspace in a centred, maximum-width, separately
  scrolling column, which had left it inset on both sides with a second scroller around
  a full-height child.
- Upload, media library and reuse sit in one row as three ways of choosing the same
  file, rather than stacked full width down the pane.
- Scene identifiers and asset keys truncate with their full text in a tooltip instead of
  breaking mid-word.
