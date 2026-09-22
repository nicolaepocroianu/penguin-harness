# Carrying out an import

- **Date:** 2026-09-22
- **Type:** feat
- **Scope:** `server`

The mapping decides what Penguin would make of a Loom activity. This performs it: the
product, its refs and each ref's draft actually come into existence.

## The canonical ref goes first

Penguin makes a product's **first** ref its canonical one, and the canonical ref is the only
one allowed to change the shared module — three generation stages are gated on it.
Importing refs in numeric order would hand module ownership to whichever ref sorted lowest,
which for three real products is not the ref Loom named. The first ref also carries the
module folder; later refs join what exists.

## An import can be run twice

A ref that is already there is skipped, not refused. An import that cannot be re-run is an
import nobody dares run once, and a half-finished one — a bad spec in ref seven — has to be
resumable.

## One bad ref does not lose the other nine

A ref that fails is named with its reason and the rest carry on. The single exception is the
canonical ref of a product that does not yet exist: importing the rest would promote a
different ref to canonical and give it the module, so the product is abandoned and reported
instead.

## Ownership that does not match is reported, not forced

Joining a product Penguin already holds means its canonical ref is settled, and creating the
ref Loom called canonical will not move it. That mismatch is reported. Moving module
ownership is an author's decision, not an importer's.

A book's reading mode is set once its refs exist, and never guessed when Loom recorded none.
A ref with no specification gets none written — the mapping already reported that as a loss,
and an empty spec would make it look imported.
