# Activity media tables use the shared table classes

- **Date:** 2026-10-10
- **Type:** refactor
- **Scope:** `web`

The project media, asset library and new-ref tables now take their wrapper, header row, cell and
body classes from `components/ui/table-classes.ts` instead of keeping their own copies. They look
the same as before.
