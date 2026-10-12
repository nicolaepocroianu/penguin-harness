# One rule for unsaved work, and the new-ref page asks before its choices are lost

- **Date:** 2026-10-12
- **Type:** fix
- **Scope:** `web`, `skills`
- **PR:** [#117](https://github.com/nicolaepocroianu/penguin-harness/pull/117)

The frontend skill gained an "Unsaved work" section. It says each input holding work the server
has not seen gets exactly one treatment, in this order of preference: save it, keep it, guard it
(`useHeldWork` and the unsaved-work guard), or leave it.

The new-ref page's per-asset decisions, edited narration and chosen files were registered with
the guard. Leaving the page for another section, the activity or the Project now asks first, as
does choosing another language, which starts the rows over. Making the ref releases them.

The audio editor's Length field stopped masking the asset's length after the author typed one.
It shows what the author typed only while that text is not a length yet, or while it reads as the
asset's own length.

## Details

- The guard gained a `restart` leave, for an editor starting its own work over.
- The guard gained the `new ref plan` label, with its own discard copy (`discardRefPlan`).
- `useHeldWork` now returns `release()`.
- `ref-plan.ts` gained `rowsDecided`.
- `sound-model.ts` gained `lengthFieldText`.
- Node tests were added for the restart leave and its wording, for `rowsDecided`, and for
  `lengthFieldText`.
- The new-ref end-to-end test now checks that leaving with a decision made asks, and that
  declining keeps the decision.
