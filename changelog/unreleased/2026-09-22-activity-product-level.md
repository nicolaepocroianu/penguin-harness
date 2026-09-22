# Refs of one product share a module, and one of them owns it

- **Date:** 2026-09-22
- **Type:** feat
- **Scope:** `server`

Loom nests refs under a product: the product owns the module code, one ref is canonical
and is the only one allowed to change it, and the rest are configuration on top. Three
generation stages are gated on that rule.

Penguin had `productCode` and `refNum` flattened into a single activity row with no parent,
so it could not say which ref was canonical — which means it could not host those stages
correctly. This gives the product somewhere to live.

## The shape

`project → collection → product → activity`, where the collection is the module folder and
an activity is a ref. A product carries its module folder (defaulting to
`waf-module-<productCode>`, since one folder may host several products), its canonical ref
number, and its type. A ref gains a display name and a `stable` flag.

A product is not something an author creates on purpose. It appears the moment the first
ref of a product code does, that ref becomes its canonical one, and every later ref of the
same code joins it.

## The migration

Migration 18 creates the product table, adds the three ref columns, then gives every
existing ref a product: one per `(collection, product code)`, with the lowest ref number
canonical and supplying the type. Existing rows carry no opinion about which ref owns the
module, and the first one made is the least surprising answer.

A ref whose collection has no row is left without a product rather than having a project
invented for it — that activity is already unreachable, and a total migration beats a
plausible guess.

Restart-only: an older writer creates activities with no product parent, and the canonical
rule cannot be answered for them. The rollback keeps the product code, which is the real
address, and loses only the canonical marker, the module folder, and each ref's name and
stability.

## What it enforces now

Assembling a module from a non-canonical ref is refused with `ref_not_canonical`, naming
the ref that does own the module. Previously any ref would have rewritten the shared module
without saying so.

A ref with no product at all predates this and is treated as canonical — it is the only ref
anyone could have been building against.
