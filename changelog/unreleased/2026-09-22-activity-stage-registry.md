# The generation pipeline, declared rather than hard-coded

- **Date:** 2026-09-22
- **Type:** feat
- **Scope:** `server`

The nine generation stages ported from Loom now exist as a declared graph: each stage says
where it sits, whether it needs an agent, what it reads, and whether it writes the module
code a product's refs share.

Loom keeps its canonical stage order in a string array inside an Angular component, and
lets the caller pass any list it likes — the UI is the source of truth for pipeline
semantics. That is the one piece of Loom's design deliberately not ported.

## What is here

`stages.ts` holds the model as pure functions: the ordering, the transitive dependency
closure that decides what a re-run invalidates, the reverse closure for what must already
have run, and two checks — a cycle or a dependency naming a stage nobody provides, and a
stage ordered before something it depends on. Declared order and declared dependencies are
separate statements about the same thing, so the disagreement is reported rather than one
silently preferred.

`pipeline.ts` is the ported graph. Nine stages: five deterministic, four agent-driven, and
three marked as writing the shared module — the ones Loom gates to the canonical ref.

## Staleness

A stage falls behind in two ways: the draft moved under it, which the existing
`inputRevision` comparison already expresses for the module preview, or something it
depends on ran again afterwards, which is the case per-stage re-runs introduce.

Nothing re-runs automatically. With version snapshots out of scope there is no undo, so a
cascade would overwrite work an author had already reviewed and accepted with no way back.
Saying what is stale is the whole job.

## Deliberately not here yet

The kernel slot itself. A stage contributes through `Slot<Data, Code>` like HTTP routes and
sandbox providers do, but the code half is a runner, and no runner exists until the
deterministic stages land. Declaring a slot with no contributors would be an abstraction
with no user — the same shape as the dead `baseVersionId` column this port has already had
to clean up. The graph is pinned by tests in the meantime, and the slot arrives with the
first stage that can fill it.
