# What a narration run records, and what it does to the translations

- **Date:** 2026-09-22
- **Type:** feat
- **Scope:** `server`

The audio stage is deterministic — provider calls over HTTP, no workspace, no tools, no
approvals. That matters for who uses this: most of the people driving the pipeline are not
engineers, and approving tool calls to get narration would be absurd.

## The rule that carries the weight

A translated clip recorded from an English line that has since been rewritten is not stale
in any way a person can hear. It is fluent, confident, and no longer what the activity
says.

So a translation's fate follows its source. If the line was rewritten, every translation of
it is dropped. Keeping one would leave the activity saying different things in different
languages with nothing in the product noticing.

**Only a changed script invalidates a translation.** A clip being re-recorded because its
file went missing is the same words, so its translations still stand — and a test says so,
because the obvious implementation gets this wrong and quietly discards translation work.

## What is kept

A recording that remembers no script is left alone rather than redone: it may be a file an
author uploaded or accepted, and replacing it would discard a deliberate choice.

A translation that remembers no source is kept rather than guessed about. A translation of
a clip that no longer exists is left alone — it is not this run's to delete.

Preserved translations are reported explicitly, so re-recording one clip does not silently
look like it discarded the rest.

## Reporting

Dropped translations are stated as loudly as recordings, with the clip and the languages
named. Somebody rewriting one English line should learn here that two Spanish clips are
about to disappear — not afterwards.
