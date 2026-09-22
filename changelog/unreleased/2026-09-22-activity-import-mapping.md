# What Penguin would make of a Loom activity

- **Date:** 2026-09-22
- **Type:** feat
- **Scope:** `server`

The read-only reader finds what a Loom activity holds. This decides what Penguin would make
of it — and, as importantly, what it would have to drop.

The dropping is the part that matters. An import that silently loses a ref's display name,
or quietly renames a language group it does not recognise, produces an activity that looks
imported and is not the one that was authored.

## Repairs are recorded, not silent

Two things are repaired rather than refused, because refusing would make part of the real
corpus unimportable:

A product naming a canonical ref that does not exist takes its lowest ref instead — the same
repair migration 18 makes for existing rows.

A product and ref with no title between them take the ref's address, because Penguin
requires a title and Loom does not.

Both are reported. An import that is faithful but repaired is a different thing from one
that is faithful and untouched.

## Losses are named per ref

An unsupported language group, a missing specification, a missing manifest, a missing
description — each named against the ref it belongs to. A manifest that is absent entirely
is reported once, not twice: complaining that it also lacks a default language group would
be two messages about one fact.

## Assembly is asked separately from fidelity

A book with no reading mode imports **perfectly** and then cannot be assembled. That is not
a fidelity problem, so it is reported on its own — an author should learn it at import
rather than at assembly.

## Measured against the real corpus

Run over the checkout's 69 products with refs: **67 would import faithfully.** Four repairs
in total — three canonical refs that do not exist, one product naming none, one ref with no
title. Two products lose something: one has no description, one has neither specification
nor manifest.

No book is blocked on a missing reading mode; all twenty-two carry one.
