# Media markup in a scene, and the scene set a media pass may not change

- **Date:** 2026-09-22
- **Type:** feat
- **Scope:** `server`

A scene's description is prose with media elements embedded in it — `<audio>`, `<video>`,
`<image>`, `<animation>` — which is how an author says where a track plays or a picture
appears. When the specification stage produces one, the markup has to be well formed, or
the module built from it wires media to nothing.

Both rules are Loom's, read out of `media_contract.py` and `generate_media_spec.py`.

## What is reported

Every issue with a line and a column, sorted by scene then position. Sorted because an
unsorted list from a regex scan reads as random, and makes a repair pass look like it fixed
nothing.

A stack, because these nest: an unclosed `<audio>` around an `<image>` is a different
problem from a stray `</audio>`, and an author needs to be told which. A mismatched pair is
reported **once** — the open tag is consumed by the mismatch, and adding "audio was never
closed" would describe the same mistake twice.

Also caught: a closing tag written without its `<`, which is the mistake an LLM makes often
enough that Loom has a dedicated pattern for it.

## The scene set

`generate_media_spec` enriches an existing specification with media. It must not add, drop
or rename a scene — an enrichment that quietly changes the scene set invalidates every
later stage, and the module gets built for scenes the author never wrote.

Compared as sets, so reordering is allowed: that is not the failure being guarded against.
A **rename** is the quiet one — same count, so a length check alone would let it through.
