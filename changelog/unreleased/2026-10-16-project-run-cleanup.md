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

- The project's run ids were read before its rows were deleted, and their folders were removed
  once its running Sessions had settled and its project directory was gone.
- A link inside a run folder, as a module run links the shared module packages in, was removed
  and what it pointed to was kept: the packages cache other runs link to was not touched.
- A run folder that could not be removed, for example one a process still held open on Windows,
  was left in place and did not fail the deletion.
- The preview forgot the module builds it had recorded for the removed runs.
