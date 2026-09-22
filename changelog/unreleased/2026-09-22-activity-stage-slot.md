# The stage registry becomes a kernel slot, with its first stage

- **Date:** 2026-09-22
- **Type:** feat
- **Scope:** `server`

The generation pipeline was declared as a graph but held in a constant. It is now a kernel
slot: a stage contributes its declaration as pure data and its work as the code half, bound
by id — exactly how HTTP route groups, sandbox backends and messaging connectors are
already assembled. Adding a stage is adding a contribution, not editing a list.

That is the whole difference from Loom, where the canonical order lives in an Angular
component and the caller passes whatever stage names it likes.

## It checks itself once

At assembly, not when a run starts. A cycle, a dependency naming a stage nobody provides,
or an order disagreeing with its own dependencies is a wiring mistake, and discovering it
the first time an author presses Generate is discovering it in the worst possible place.
Every problem is reported together rather than one per boot.

## The first stage

`prepare_media_assets`, deterministic. Loom's version normalises the media-enriched
specification into asset records; Penguin already does that in `planMedia`, walking the
scenes and producing one manifest entry per declared image, video, animation and audio
track. So this stage is not new behaviour — it is the existing planning step given a name,
a place in the graph, and a record of having run.

No agent, no workspace to write into, no approvals. That matters: most of the people
driving this pipeline are not engineers and should not be approving tool calls to get a
manifest.

## What it reports

An asset with no file yet is **named**, up to a handful, then counted. A manifest with
unbound assets is not a complete manifest, and saying "prepared 12 assets" while twelve of
them point at nothing would be the kind of quiet success this port is not allowed to
produce.
