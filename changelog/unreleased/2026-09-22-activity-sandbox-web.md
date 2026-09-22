# A build an author can see

- **Date:** 2026-09-22
- **Type:** feat
- **Scope:** `web`

The Module section of an activity now shows what the harness knows about its module build,
and lets an author build it.

This is separate from the existing preview, which runs the bundle an assembly agent
produced. The panel reports the harness's **own** build of the same module, so a build that
fails is something an author can see and act on rather than a preview that never appears —
the output is shown in full, because a webpack failure is only readable that way.

Build forces a rebuild. An author pressing it after a build they believe failed is asking
for a build, not a freshness opinion.

## What the states mean

A ref that does not own its module reads as muted rather than as a warning: it is not a
fault, it is this ref not being the canonical one, and nothing the author does here changes
it. Stale reads as attention, because something will happen when they press Build. Every
state carries its sentence, so nothing is colour-only.

Build is offered even when the module is current — a rebuild is what an author asks for
when they do not trust the last one — and withheld when there is no specification or the
ref does not own the module, which are the two cases where it could not work.
