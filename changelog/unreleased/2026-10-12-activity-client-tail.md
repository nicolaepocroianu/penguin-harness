# The activity studio's last raw requests, and its remaining silent-loss paths

- **Date:** 2026-10-12
- **Type:** fix
- **Scope:** `web`
- **PR:** [#113](https://github.com/nicolaepocroianu/penguin-harness/pull/113)

## Guard fixes

Unsaved work in Scenes stopped being lost silently in three places:

- A scene video's timeline edits no longer went without a word when the author picked another
  asset or language, went back to the storyboard, or used the scene navigation. Those moves
  now ask the unsaved-work guard first.
- An uploaded or trimmed audio file waiting on a card now asks before it is lost.
- An upload waiting beside a bound file now asks before it is lost.

## Typed client

The activity studio's remaining raw `apiFetch` calls moved to the typed client:

- **Activity routes:** `activityApi` gained the routes of the ref switcher, the new-ref page,
  versions, module documents, module builds, deploy runs, implementation features, the
  sandbox payload, media copies and the video timeline.
- **Project-level calls:** `activitySetupApi` was renamed `projectActivitiesApi` and took over
  the project's own calls: the list, refs, creating an activity, module products, the media
  library and scene looks. `project.activity(id)` reaches another activity of the project.
- **Shared reads:** Activity Stats and Implementation Features read through the shared cache.
  Activity Stats shares its read with the scenes' file details.

## Details

- The guard gained asset leaves (`{ kind: "asset", to }`). Held work can now say which asset
  it belongs to, or that it stays while the editor shows any asset.
- `discardWording` chooses the dialog's words from what would be lost. Leaving the activity
  keeps the words it always had.
- Two strings were added: `discardTimeline` and `discardFile`.
- `timelineUrl` was removed from `scene-timeline.ts`; the client builds that route.
- Tests: the guard tests were extended, and route tests were added for the client. The
  timeline e2e test now also checks that picking another asset asks first.
