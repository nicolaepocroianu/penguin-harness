# The outcome ledger knows who changed a draft and who accepted a run

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `server`
- **PR:** [#125](https://github.com/nicolaepocroianu/penguin-harness/pull/125)

`ActivityOutcomes` gained `attribute(cause, operation)`: the draft changes witnessed inside
`operation`, and the runs opened inside it, belong to `cause` — an author, the Stages, or a run
applying its own result, and the run whose candidate a change accepts. Causes nest, the inner one
winning field by field. Every activity route ran under the author's cause, the Stages ran their
whole sequence under their own, the engine's accept named the run it accepted, a specification
pass applied its result under the run's own cause, and applying an assist proposal named its
conversation.

## Details

- A draft change under a run's cause accepted that run: its parts became the run's, and the run
  recorded who accepted it and when (`accepted_by`, `accepted_at`, the first time), which a tally
  counts as `accepted` and `accepted.<actor>`. A part another run's candidate replaced counted
  `replaced` on the run it came from.
- An edit counted against the run whose part it changed, by who made it (`edits.author`,
  `edits.stages`, `edits.run`) with the bytes it rewrote; a change no cause owned counted as
  `edits.unattributed`, never as an author's edit. A return to an earlier version gave the part
  back to the run it came from then, counting `reverted` on the run that lost it.
- A run recorded who started it (`startedBy.author` or `startedBy.stages`), so a specification
  pass the Stages started stays theirs although it applies its own result.
- A write outside a change (a new ref, a renumbered ref, an older draft moved into its module)
  and a pinned build changed no part's run and counted as nobody's edit.
- Prompts and staged files stayed as they were.
