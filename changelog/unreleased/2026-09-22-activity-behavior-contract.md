# What an implementation run must leave behind

- **Date:** 2026-09-22
- **Type:** feat
- **Scope:** `server`

`implement_behavior` is the heaviest stage in the pipeline: an agent writes the module's
real behaviour, then a second pass reviews it. Two agent passes over generated code is a
lot of trust, and what makes it checkable is a contract — the files that must exist when it
finishes.

The three path lists are Loom's, read out of `implement_behavior.py`: the nested
state-machine layout, the flat one, and the sequence path.

## The layout is read, not chosen

`src/activity/index.ts` means the nested layout; anything else is flat. Deciding for the
agent would mean rejecting a single-file implementation that works.

## Every missing file is named

Loom asserts the paths exist. The useful version names all of them. An agent told only the
first missing file fixes it, gets re-reviewed, and is told the next — which turns one round
trip into six, each a paid agent pass.

## One deliberate difference from Loom

Loom always runs the review pass. This skips it when the contract was not met: a review
over an implementation that has not produced its required files spends a second agent run
to be told what the contract check already knows, and its findings are about code that is
about to be rewritten anyway.
