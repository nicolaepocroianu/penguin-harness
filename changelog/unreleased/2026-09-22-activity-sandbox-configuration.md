# The configuration a module receives in the preview

- **Date:** 2026-09-22
- **Type:** feat
- **Scope:** `server`

The sandbox builds the module, serves its media, runs assessment sessions and admits
runtime AI. What was missing is the thing the module asks for first: the activity payload
the learner runtime fetches, carrying the module's configuration, its layout and its
compartments.

## A translated activity carries only what differs

Serving the requested language group alone gives a half-translated activity missing scenes,
because a translation records only what changed. The requested group is layered over the
default and both are sent — the module still expects to find the default.

A language the activity does not have falls back to the default. It plays in English, which
is visibly wrong and therefore reportable, rather than not playing at all.

## The start scene keeps the name the modules already read

`configuration.__loomPreview.startSceneId` is not a name chosen here: the module templates
this harness generates read it before the state machine boots, and the book reader entry
does the same. Renaming it would break every module already authored.

It is written into a copy rather than in place, so two previews on different scenes cannot
overwrite each other's start.

## Small things that matter

A preview payload's id is prefixed `preview:`. The same shape reaches the same runtime, and
that prefix is the only thing separating a preview from a deployed activity.

The assessment keys are omitted, not nulled, when there is no assessment — their presence is
what tells the runtime to open a session, so an empty key opens one with nothing in it.
