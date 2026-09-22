# Importing a Loom activity, end to end

- **Date:** 2026-09-22
- **Type:** feat
- **Scope:** `server`

Reading a Loom product, deciding what Penguin would make of it, and making it are now one
call and two routes. `GET .../activities/import-sources` lists what the checkout offers —
looking imports nothing — and `POST .../activities/import` performs one product.

Every write it makes is an ordinary authoring call, so an imported activity is
indistinguishable from one made here afterwards. That is the point: the round-trip trial
compares like with like.

## A specification Penguin will not accept is caught before anything is written

The first end-to-end run found a real fault. A ref whose spec the validator refuses was
created, and only then failed on the spec — leaving an activity that loads and does nothing,
which a second run would skip because it exists.

The spec is now validated while **mapping**, before the store is touched. A refused spec is
a reported loss and the ref imports without one, exactly as a ref that never had one does.

## Refs that exist but were not finished are reported as such

For the failures that can only happen after creation — a conflict, a full disk — the ref is
real and a re-run will skip it. Those are reported apart from both successes and failures,
because an author has to be told which imported refs are empty.

## New authoring calls

`setRefIdentity` writes what an author calls a ref and whether others may build against it.
Neither goes through the draft revision: renaming a ref does not change its content, and
routing it through the draft would make a label edit conflict with an unsaved specification.

`setProductBookMode` writes a book's reading mode on the product, where it belongs — every
ref of a book shares one module, and a module is built either read-along or decodable.

`normalizeDisplayName` treats an empty name as absence rather than an error: the product
code and ref number stay the address, and a ref with no name shows its address.
