# Activity tables use the shared table classes

- **Date:** 2026-10-10
- **Type:** refactor
- **Scope:** `web`

Every activity table now takes its wrapper, header row, cell and body classes from
`components/ui/table-classes.ts` instead of keeping its own copy: project media, asset library,
new ref, production deploy, layouts, module builds, quality checks, test results and versions.
The layouts table centres its cells on the row, because its rows hold controls; that variant is
the new shared `TD_MIDDLE`. Every table looks the same as before.
