# Activities open in place, as Loom opens them

- **Date:** 2026-10-24
- **Type:** feature
- **Scope:** `server`, `web`
- **Breaking:** no

The Activities list now shows every product in the WAF workspace's modules, from the checkout's own `modules/` and from the monorepo's modules folder. Click one and it opens. Nothing is written to the module or the media repository until you first change it, and then only Loom's own files are written.

- Listing indexes each product and ref in the database only: ids, title, canonical ref and tags. A ref with no saved draft is read from Loom's files in memory, with its specification and a media plan that carries Loom's bindings.
- A ref's first change writes its draft as Loom would: `activity_spec.json`, `asset_manifest.json`, `activity_description.txt` and `activity_metadata.json`. The placeholders its media plan binds are seeded into the media repository at the same moment.
- WAF Harness's bookkeeping for a draft (revision, status, media-plan requirements, module document edits, pinned build) moves from `wafh.json` in the module to the `activity_drafts.state` column. Who owns a product comes from the index only.
- No more `wafh.json` files or `.loom.json` copies are written. Existing ones are read, and their ids are kept, but they are never changed or removed.
- **Open from modules** and its endpoints (`GET .../activities/module-products`, `POST .../module-products/claim`) are removed.
