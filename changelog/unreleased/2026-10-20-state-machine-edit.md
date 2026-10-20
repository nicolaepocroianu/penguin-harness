# Authors can read and edit a ref's state machine in the Studio, as in Loom

- **Date:** 2026-10-20
- **Type:** feat
- **Scope:** `server`, `web`
- **PR:** [#171](https://github.com/nicolaepocroianu/penguin-harness/pull/171)

A new State machine section under Build & ship opens the ref's `spec/state-machine.json` in the JSON editor, with Diff against the last save. It lists every problem with where it is: the saved machine's, then the problems in the text as it is typed. A save runs Loom's checks and is refused only for problems the edit introduces. The edit is kept in the draft and written to the module's file, and the preview and the next assembly use it until it is discarded. The behaviour map beside the player links to the section.

## Details

- New routes under `/api/projects/<project>/activities/<id>/state-machine`: `GET` (Loom's document with its problems), `PUT {definition, expectedRevision}`, `POST check {definition}` and `POST discard {expectedRevision}`. An invalid machine gets a 400 `state_machine_invalid` that names its first problems.
- A save bumps the draft revision, so what was built from the old one reads as out of date. Discard brings back the earlier revision and the module file's exact earlier contents.
- An assembly may add to an edited machine, never change it. The edit is reported stale when the specification changes.
- A book's reader machine is shown but not edited (409 `book_state_machine`), because the book compiles it into its configuration.
