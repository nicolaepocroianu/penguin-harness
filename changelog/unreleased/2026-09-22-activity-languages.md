# The languages an activity can be authored in

- **Date:** 2026-09-22
- **Type:** feat
- **Scope:** `server`

Penguin's asset manifest has always been keyed by language, and has always held exactly one
key. The validator accepts a hundred; nothing ever created a second. The rail's language
selector has one option, permanently.

This is the data half of fixing that.

## A closed table, not an open regex

Loom's, out of `activity-languages.json`: English as the default, Spanish and Romanian as
translation targets. A language is not just a code — it needs a folder its media sits
under, a label an author reads, and a name a translator will recognise. An open regex
cannot supply any of those.

Adding a language is adding a row and nothing else.

## The default has to be there first

A manifest translated into Spanish with no English to translate *from* is not a
multi-language activity. It is an activity whose default group is missing, and every later
stage would look for a source that is not there.

So adding a language is refused when the default is absent, and a manifest without it is
reported as a problem rather than accepted as an unusual arrangement.

## Media goes under the language's folder

`media/loom/<product>/<product>-<ref>/audios/spanish/intro.mp3` — the folder name, not the
code, which is what Loom writes and therefore what an import has to match. Visual types use
their plural folders: `images`, `videos`, `animations`.

An unknown type, an unknown language or an empty extension returns nothing rather than a
plausible-looking path into a directory that should not exist.
