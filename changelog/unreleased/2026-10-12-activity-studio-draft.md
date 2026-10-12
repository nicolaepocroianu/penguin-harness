# The activity studio's draft moved into one module

- **Date:** 2026-10-12
- **Type:** refactor
- **Scope:** `web`
- **PR:** [#108](https://github.com/nicolaepocroianu/penguin-harness/pull/108)

The draft logic was moved out of the activity editor page into a draft module,
`features/activities/studio-draft.ts`, with a thin `useStudioDraft` hook over it. The module
holds the saved draft, the author's script, specification and manifest texts, and what is
unsaved. It also runs both autosaves, sends one change at a time, and decides what may be
pressed.

## Details

- Every draft change names the draft's revision itself. The editor no longer passed
  `expectedRevision` by hand.
- Each draft the server sends back goes through one call, `applyDraft(draft, keep)`. That call
  says whether the author's unsaved text is kept. It also carries the rule that a valid
  specification's title becomes the activity's title.
- The poll's draft goes through `receive`. It is not applied over unsaved text, and when the
  draft has moved it reports that instead.
- The manifest shape check was moved into the module as `readManifest`.
- One gate, `can(action)`, replaced the editor's inline checks for what may be pressed. It
  returns the first reason an action is blocked, in a fixed order per action, and the views map
  each reason to the strings they already used.
  - The checks it replaced fed generate, accept, preview, Run stages, record words, the
    assessment, plan media, and the book-words and speech panels.
  - `testBlocked` and `checkBlocked` now take the draft's `tests` and `quality` reasons, and
    add only their own: a run the panel is starting, and the test browser.
- Starting a run, adding it to the history and reading the history again became one step,
  shared by the editor and the tests, quality and conversation panels.
- The asset editor took the draft in place of 17 props: its gates, revision, saved manifest,
  media autosave state, and its save, accept, timeline and word-sound callbacks.
- Node tests were added for the module. They cover the autosaves, a run holding them back,
  the poll against unsaved text, both ways of applying a draft, one change at a time, and
  every gate's reasons in order.
