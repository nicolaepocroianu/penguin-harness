# Serving a built module's own files

- **Date:** 2026-09-22
- **Type:** feat
- **Scope:** `server`

The payload points a module's `require` entries at a per-activity route; this answers it.
`GET .../activities/:activityId/sandbox/module/*` serves the built module's code, styles
and layout.

## Which files may be served at all

A build workspace holds the module's sources, its `node_modules`, its build log and
whatever else the assembly agent wrote. Handing out the rest would turn a preview route into
a way to read a workspace, so there are three refusals and each has a reason:

- A path that climbs out is refused by shape, as everywhere else in this port.
- `node_modules`, `.git` and `.typescript-build` are closed. A preview has no business in
  any of them, and the first is most of the workspace.
- An extension nobody serves is refused rather than sent as bytes. A workspace holds
  `.log`, `.ts` and `.env` files, and none of them belong in a browser.

A bad path is refused before the build is looked up, so answering it never tells a caller
which activities have been built.

## Never cached

A preview exists to show the build that is there right now. A module file at a stable URL
with a cache header is how an author ends up looking at yesterday's code without knowing it.
Media is versioned instead, because it is large and its URL carries the draft revision.

Read whole rather than ranged: these are small text files fetched once at load, and the
media route already handles what needs ranges.
