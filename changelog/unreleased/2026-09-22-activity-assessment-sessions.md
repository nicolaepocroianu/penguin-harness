# A learner session for a preview, scored locally

- **Date:** 2026-09-22
- **Type:** feat
- **Scope:** `server`

An activity with assessment talks to a WAF backend: it opens a score, submits responses and
reads a result. Without that, the only way to find out whether an activity's assessment
works is to deploy it — the opposite of a preview.

Loom emulates it with in-memory sessions on a TTL, and so does this. Nothing here reaches a
real student or telemetry service; a preview that quietly talked to production would be
worse than no preview.

## Loom's rules, read rather than guessed

The two interaction kinds and their constraints come from Loom's own validator:
`SIMPLE_CHOICE` needs exactly one correct choice, `MULTIPLE_RESPONSE_CHOICE` at least one,
and both need at least two choices.

An assessment that breaks those is refused at the point a score is opened, with every
problem named, rather than producing scores nobody can interpret.

## Scoring

A multiple-response item is right only when the chosen set is **exactly** the correct set.
Picking every choice is not a way to be right — the one rule a hand-rolled scorer usually
gets wrong, and there is a test named for it.

A second response to the same item **replaces** the first. An activity that lets a learner
change an answer before submitting would otherwise score them twice.

## Lifetime

Fifteen minutes since last use — longer than any preview sitting, short enough to forget.
In memory deliberately: a preview score is scratch data, and persisting it would mean
deciding how long a throwaway assessment attempt is worth keeping, which is a question
nobody wants to answer in a migration later.

Finishing is idempotent, because a runtime may finish twice on a fast exit.
