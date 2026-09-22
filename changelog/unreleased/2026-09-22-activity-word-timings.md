# Word timings for narration

- **Date:** 2026-09-22
- **Type:** feat
- **Scope:** `server`

Forced alignment looks like an optional extra until you notice what depends on it: a book
activity highlights each word as it is spoken, and the highlighting comes from these
timings. Drop them and the read-along silently stops reading along — narration plays, no
word lights up, and nothing reports a fault.

The rules are Loom's, out of `book/alignment.py`.

## What an alignment has to be

One timing per spoken word, in the script's order, ascending and non-overlapping. Overlap
matters: a highlight that starts before the previous word finished highlights two words at
once.

Punctuation is not spoken, so it is not aligned — `"cat,"` and `"cat"` are the same word
here. Apostrophes and hyphens stay, being inside words rather than between them.

Every problem is collected rather than thrown at the first, because an author looking at a
broken read-along needs to know whether one word is off or the whole clip is aligned
against a different script.

## What a manifest records

Only what is known. A provider with no native timestamps adds **nothing** rather than an
empty array: an empty `wordTimings` reads as "aligned, no words", and a reader would then
report highlighting as available and highlight nothing.

Whether a clip can highlight is asked explicitly, so a reader can say "narration without
highlighting" instead of playing audio and leaving an author to wonder why nothing lights
up.
