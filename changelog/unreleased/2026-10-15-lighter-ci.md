# CI runs less, so a burst of runs cannot get Actions disabled again

- **Date:** 2026-10-15
- **Type:** process
- **Scope:** `ci`, `skills`

GitHub disabled Actions on the fork after a day of many full runs, each 21 jobs across ubuntu, macOS and Windows. The CI workflow now runs the expensive jobs only where they add evidence.

## Details

- A change that touches only `changelog/`, `.agents/`, `docs/` or root Markdown files runs no CI.
- A push to `main` runs the ubuntu jobs only; the same tree already passed the full matrix as a pull request.
- A draft pull request runs the ubuntu jobs only. Marking it ready for review runs `test-macos`, `test-windows`, `installer-windows` and the runtime builds; a manual dispatch runs everything.
- The `ci` gate accepts those jobs as skipped.
- The `penguin-harness-dev` skill tells agents to open pull requests as drafts while iterating, push in batches, and mark them ready for the full matrix.
