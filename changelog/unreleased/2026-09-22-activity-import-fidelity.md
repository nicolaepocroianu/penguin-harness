# Two reasons a real Loom activity would not import

- **Date:** 2026-09-22
- **Type:** fix
- **Scope:** `server`

Running the import over the real checkout dropped the faithful count from 67 products to
60. Eight of 85 refs had a specification Penguin refused. Seven of those eight were
Penguin's fault, not the data's.

## An asset that has not been produced yet

Loom writes `targetPath: null` for every asset a generation stage has not filled in — which
is most of them, for most of a project's life. The validator accepted a string or absence
and refused `null`, so it refused the ordinary state of an unfinished activity. Two whole
specifications were lost to it.

`null` now means the same as absent, matching how `audience.gradeBand` already reads.
Nothing that validated before stops validating.

## A specification naming the wrong module folder

Five refs carry an old misspelling — `wafmodule-clap-syl` for a product that lives in
`waf-module-clap-syl`. The folder inside a specification is a redundant copy of where the
product actually is, and the directory already states the truth, so losing a whole activity
over a stale copy would be absurd. The import corrects it from disk and records the
correction.

## What is left

One ref of 85 still has a specification Penguin will not accept: it has no `id` at all.
That one is genuinely incomplete, and it is reported rather than repaired.

**Measured after both fixes: 67 of 69 products would import faithfully, 85 refs read, no
book blocked on a missing reading mode.**
