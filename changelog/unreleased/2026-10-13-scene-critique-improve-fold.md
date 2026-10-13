# The scene critique's Improve explanation became a fold, and the Activity Spec's view choice joined the install-scope table

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `web`
- **PR:** [#PR](https://github.com/nicolaepocroianu/penguin-harness/pull/PR)

The explanation of a scene critique's **Improve until it scores 4** button moved from a circled
"?" beside the button into a **More info** fold under the button row, because a "?" may only
follow a title. The Activity Spec's remembered scenes-or-JSON view
(`penguin.activitySpec.view`) was classified as a browser preference in the install-scope table,
so a data-root change keeps it, as it always had. Three web tests that had failed on `main` passed
again.

## Details

- `SceneCritiqueView` rendered the Improve explanation through `HelpFold`, labelled with the
  button's text, and kept the "?" beside the Critique heading.
- `KEY_RULES` gained an exact `browser` rule for `penguin.activitySpec.view`. The key's name and
  stored values did not change.
- `model-grouping.test.ts` listed the Z.AI Coding Plan group after Z.AI (GLM) in the default
  provider order, matching the catalog since that group was added.
