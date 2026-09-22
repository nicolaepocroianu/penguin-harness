# The migration trial

- **Date:** 2026-09-22
- **Type:** test
- **Scope:** `server`

Real, already-shipped Loom activities imported into a real Penguin store, over HTTP, and
read back. This is the gate on switching Loom off, so it runs against the actual checkout
rather than a fixture, and skips when there is no checkout on the machine.

Three products, chosen for what they stress rather than for passing:

- `r2phcs03L` — one ref, two language groups. Multi-language arrives through the manifest.
- `lang1` — all three supported languages.
- `r2pt01` — a decodable book with ten refs, the product level under real load.

For each ref, what Penguin stored is compared with what the mapping said it would store:
the specification exactly, the description exactly, the draft valid. For the book, the
canonical ref is created first, so the module stays on the ref Loom named.

A fourth check edits an imported activity through the ordinary authoring route. The bar is
not only that an import lands — an imported activity has to be an ordinary one afterwards,
or authoring in Penguin means re-authoring.

## What this does not yet prove

Reproducing built **output** — assembling the module and comparing it to what Loom shipped —
is not covered. Assembly writes into the module folder, and the checkout is read-only here.
That comparison needs the deploy path, which is scoped for later.
