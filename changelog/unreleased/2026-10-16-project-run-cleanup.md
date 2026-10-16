# A deleted project's activity run folders are removed with it

- **Date:** 2026-10-16
- **Type:** fix
- **Scope:** `server`
- **PR:** [#157](https://github.com/nicolaepocroianu/penguin-harness/pull/157)

Deleting a project, and so an admin deleting a user who owned projects, removed the project's
activity run folders (`activity-runs/<runId>` under the server root) along with its rows and its
project directory. Before, every run folder stayed on disk with whatever the run had staged and
made: its draft copy, prompts, media takes, recordings, renders and module builds.

## Details

- The project's run ids were read before its rows were deleted. Their folders were removed once
  the project's running work had settled, before the project directory was: a project directory
  that could not be removed no longer kept the run folders too.
- Speech and sound runs (media helpers, local audio) and test runs that reran earlier checks,
  which have no Session, were stopped with the project's Sessions. The deletion waited for them
  to end, within the same 5-second cap, before removing any folder.
- A preview build of a run's module was counted as the project's work. Deleting the project
  waited for one already building, and a build asked for during the deletion was refused with
  `project_deleting`.
- A link inside a run folder, as a module run links the shared module packages in, was removed
  and what it pointed to was kept: the packages cache other runs link to was not touched.
- A run folder that could not be removed, for example one a process still held open on Windows,
  was left in place, did not fail the deletion, and was named in the server log with its error
  code.
- The preview forgot the module builds it had recorded for the removed runs.
