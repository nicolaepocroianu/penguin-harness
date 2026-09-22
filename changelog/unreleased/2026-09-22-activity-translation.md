# Translating narration scripts

- **Date:** 2026-09-22
- **Type:** feat
- **Scope:** `server`

Loom translates the **script**, records the new script against the language, and speaks
that. The ordering is the whole design: a translation is a piece of text an author can read
and correct, not an opaque audio file. Somebody who speaks Spanish can look at what the
activity will say before a single clip is recorded.

It also means a translation carries the source it came from, which is what lets a rewritten
English line invalidate exactly the translations made from it.

## What needs translating

Never translated, or translated from a line that has since been rewritten. Those two are
kept apart in the reporting, because they are different situations: one is work not done,
the other is work that must be done again because the English moved. Collapsing them hides
why.

A translation with no remembered source is treated as current rather than guessed about. A
translation whose script no longer exists is reported separately — it is not work to do, it
is a leftover.

A source line with nothing in it is skipped: an empty line translates to an empty line, and
asking a model to do it spends a call to learn nothing.

## What a request carries

The language name a translator recognises — "Mexican Spanish", not `es-MX`. Requests are
ordered by key then language so a run is reproducible and a partial one can be resumed
without guessing where it stopped.

## What a finished translation records

The source text it was translated from. Without it, nothing can later tell a translation
that is still true from one whose English was rewritten, and the activity ends up saying
different things in different languages with nothing noticing.
