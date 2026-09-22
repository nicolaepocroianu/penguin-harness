# Which images a run draws, and which it leaves alone

- **Date:** 2026-09-22
- **Type:** feat
- **Scope:** `server`

Loom's images are SVG written by the coding agent, not raster output from a diffusion
model. That makes the skip rules matter more than they otherwise would: an agent pass per
image is expensive, and regenerating artwork an author already accepted is worse than
expensive — it silently replaces work somebody looked at.

The rules are Loom's, out of `generate_images.py`.

## The one that is easy to get backwards

`assets_configuration` binds every image asset to a shared `empty.jpg` so the module has
something to load. **A placeholder counts as absent.** Treating it as generated artwork
makes every asset look finished and the whole stage do nothing.

## The rest

- An unbound asset is drawn.
- A bound SVG that is not on disk is drawn.
- A bound SVG whose recorded description no longer matches is drawn.
- A bound SVG that matches is left alone.
- An **uploaded** file — anything not an SVG — is left alone. It was not drawn, so it is
  not the stage's to replace.
- A non-SVG target that is not on disk is **refused**, naming what to do: upload a file or
  clear the path. There is nothing to keep and nothing that can be drawn there.
- Artwork with no recorded description is left alone rather than assumed stale, because
  regenerating it would replace something an author may have accepted.

## Reporting

A refusal is named, never folded into the skip count. An asset that cannot be drawn needs
an author to do something; one that is already current does not.

## Checkpointing

Loom writes the manifest after every generated image rather than at the end, and that is
worth keeping. An agent pass per image means a run of twenty can be interrupted two thirds
through, and a manifest written only at the end would throw away thirteen images somebody
paid for.
