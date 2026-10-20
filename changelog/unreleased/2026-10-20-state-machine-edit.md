# Authors can read and edit a product's state machine in the Studio, as in Loom

- **Date:** 2026-10-20
- **Type:** feat
- **Scope:** `server`, `web`
- **PR:** [#171](https://github.com/nicolaepocroianu/penguin-harness/pull/171)

A new State machine section under Build & ship opens the product's `spec/state-machine.json` in the JSON editor, with Diff against the last save. It lists each problem with where it is: the saved machine's, then the problems in the text as it is typed, along with a warning for each action, guard or service the module's code never mentions. A save runs Loom's checks and is refused only for problems the edit introduces. It writes what Loom's save writes, and the preview and the next assembly use the edit until it is discarded. The behaviour map beside the player links to the section.

## Details

- New routes under `/api/projects/<project>/activities/<id>/state-machine`: `GET` (Loom's document with its problems), `PUT {definition, expectedRevision}`, `POST check {definition}` and `POST discard {expectedRevision}`. An invalid machine gets a 400 `state_machine_invalid` that names its first problems.
- As Loom does, a save writes the product's `generated/<pc>/spec/state-machine.json`, removes the ref's own copy and syncs the machine and its scene catalog into the ref's configuration. Every ref shares the machine, so it is edited on the canonical ref (409 `not_canonical` elsewhere). A discard, or restoring a version, puts every file back byte for byte. Restoring a version now keeps an edited configuration's file in step too.
- Every check runs every time: a problem the saved machine already had never hides a new one. A leaf state that names an `initial` child is refused, as the player refuses it.
- A save bumps the draft revision, so what was built from the old one reads as out of date. The edit is reported stale only when the specification's scenes change.
- An assembly starts from the edited machine, now written where Loom and the waf-state-machine skill keep it: the product's file. It may add to the machine and drop a scene the specification no longer has. It may not change what the author wrote or put back what they removed, and the machine checked is the one the configuration is synced from. A play of one module run plays the machine that run built.
- A book's reader machine is shown but not edited (409 `book_state_machine`), because the book compiles it into its configuration.
