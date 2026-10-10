# The Activity runs folder keeps its place

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `web`

- Archiving or restoring a run now moves the folder's count and paging, so "More" no longer skips
  the last run after one is archived, even while a refresh is under way.
- A refresh with more than 1000 runs loaded reads them in pages of 1000. The server rejects a
  larger page, and the folder used to empty.
- When a refresh of the runs fails, the folder keeps the runs it had.
