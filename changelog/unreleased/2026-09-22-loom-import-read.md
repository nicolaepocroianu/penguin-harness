# Reading an activity Loom already authored

- **Date:** 2026-09-22
- **Type:** feat
- **Scope:** `server`, `plugins`

Strictly read-only. This opens Loom's authoring layout under its modules directory and
reports what it found: products, their refs, which ref is canonical, the specification, the
asset manifest, the description, the languages, and everything that could not be read.
Nothing is written.

That restraint is the point. Nine generation stages are about to be built on the product
hierarchy added earlier, and the cheapest way to find out whether that hierarchy can hold
real Loom data is to read real Loom data with something that cannot damage it.

## Source

Loom's **authoring** layout, not the exported `waf-activity-data` projection. The
projection is what gets deployed and is lossy for authoring — no description, no asset
manifest, no state machine.

## What reading the real corpus changed

Run against the checkout's 443 module folders: **69 products, 85 refs**.

- **Seven products have more than one ref**, one of them ten (150 through 168). The product
  level is load-bearing, not theoretical.
- **All three languages appear** — `en-US`, `es-MX`, `ro-RO`. Multi-language is real data,
  not an aspiration.
- **22 of 69 products are books.**
- **Three products name a canonical ref that does not exist.** Real data violates the
  invariant, so the importer reports it rather than assuming; migration 18's choice of the
  lowest ref is a repair, not a formality.
- **A missing ref-level state machine is normal**, not a problem: 84 of 85 refs have none.
  Loom keeps the canonical machine on the product and materialises it down to a ref only
  when behaviour implementation runs. The first version of this reader called that a
  problem on every ref; it now checks the product and treats the ref copy as optional.

## A correction to the skills plugin

The two sequence skills were dropped as legacy, on Loom's own labelling. Counting the
checkout corrected that: **299 modules are built on `src/sequence.js` and 4 on the state
machine.** Calling the sequence path legacy is true of new work and false of the corpus
that has to be imported, so both skills are restored.
