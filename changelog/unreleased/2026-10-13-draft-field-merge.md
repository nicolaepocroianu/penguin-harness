# The studio's draft merges a newer saved draft field by field

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `web`
- **PR:** [#119](https://github.com/nicolaepocroianu/penguin-harness/pull/119)

The studio's draft stopped freezing whenever the author held unsaved text, and stopped refusing
a save because some unrelated part of the draft had moved. A newer saved draft, whether from the
poll or read again after a refused save, is now merged one field at a time. The fields are the
script, the specification (whole), each property of each asset in the media plan, and each
timeline being edited. This is done by a new module, `draft-merge.ts`.

## Details

- **Merge rules.** For each field:
  - A field the author did not edit takes the server's value.
  - An edit whose field did not change on the server stays, now sitting on the newer draft.
  - An edit the server already holds has landed and is cleared.
  - A field changed on both sides keeps the author's edit and is marked as a conflict.
- **Comparison.** Values are compared regardless of key order.
- **Conflict notice.** The "saved draft changed" notice now names the parts in conflict. It uses
  the new `remoteChanged(parts)` and `conflictParts` strings.
- **Resolving a conflict.** The conflict notice offers two choices for each thing in conflict:
  - "Keep mine": the edit now sits on the newer draft, and the next save writes it.
  - "Use saved": the edit is dropped and the saved value shows.

  For the script, the notice can also open the script editor's comparison with the saved script.
  For a timeline, it says how long each version plays.
- **Saving a conflicted field** is refused with the existing "Draft changed" text until the
  author resolves the conflict or reloads.
- **Refused saves.** When the server refuses a save with `draft_conflict`, the draft is read
  again and merged. If what the save writes is not in conflict, it is sent once more.
- **Media plan saves.** The media autosave and Save send the merged plan: the server's newer
  fields with the author's edits on top.
- **Timeline edits moved into the draft.** A scene video's timeline edits are now held by the
  draft (`editTimeline`, `dropTimeline`, `saveTimeline`) instead of the timeline editor:
  - A newer revision no longer wipes them.
  - They are still saved through the explicit Save.
  - A failed save keeps the edit and shows why.
  - Closing the editor drops the edit, after the unsaved-work guard has asked.
- **Tests.** Store tests were added for:
  - timeline edits surviving another asset's change;
  - an own save landing;
  - a conflict on the same field;
  - a refused save being retried, or refused, in conflict;
  - the merged plan autosave;
  - the specification's merge.

  The timeline end-to-end test now saves over a newer draft from elsewhere.
