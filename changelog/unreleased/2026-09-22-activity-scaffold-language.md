# A built module starts in the language it was authored in

- **Date:** 2026-09-22
- **Type:** fix
- **Scope:** `server`

The module scaffold hardcoded `en-US` as the runtime's default language. That was invisible
while a manifest could only ever hold one group — and it is the last thing that would stop
a second language from reaching a built activity.

A module built with the default fixed ignores every other language group it was given: the
clips are there, the configuration names them, and the runtime never asks for them. The
activity plays, in English, with a Spanish manifest sitting beside it.

It now comes from the manifest.

## When the default is not there

An import from Loom can carry a manifest whose groups this build does not recognise.
Building such a module in a language nothing has assets for would produce an activity that
loads and then plays nothing, so an unrecognised set falls back to the default rather than
to whichever group happened to be first.

A manifest with one recognised language and no default builds in that language, which is
what an author who removed English would expect.
