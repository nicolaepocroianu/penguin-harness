# A ref's own media in the module the preview serves

- **Date:** 2026-09-22
- **Type:** feat
- **Scope:** `server`

Refs of one product share a module, so the module declares the canonical ref's assets.
Every other ref is that same module pointed at different media — which is the whole reason
the product level exists. Without overlaying the ref's manifest onto the shared declaration,
every ref of a product plays the canonical ref's audio.

## A ref may call an asset something else

The module code is shared and refers to its own key, so a ref that renames an asset has to
answer to both names — in the declaration and inside the configuration a module reads
directly. Only the language group the asset belongs to is touched: writing a Spanish clip
into the English group is how an activity ends up speaking the wrong language.

## The browser caches by URL

A regenerated clip sits at the same path, so without a version the old sound keeps playing
until someone clears their cache. Every URL the manifest produces gets a version token, and
the replacement is driven by the manifest rather than by rewriting whatever looks like a
media URL — a string that merely resembles one is left alone.

## What stays out

A path outside the media root produces no URL at all: it is not a media asset, and serving
it from the media route would be a way out of that root. A book's per-word audio and video
other than a book intro stay out of the declaration, as they do in Loom; they are addressed
by the book configuration and the module's own code.

Nothing here mutates its input. The declaration is read once and served to every ref, so
overlaying in place would give ref 2 the media of whichever ref was previewed last.
