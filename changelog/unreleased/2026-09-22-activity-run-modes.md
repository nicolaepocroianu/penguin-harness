# Three ways to drive the pipeline, over one registry

- **Date:** 2026-09-22
- **Type:** feat
- **Scope:** `server`

Loom can only run stages as a batch: a list of names goes in, they execute in order, and
that is the whole vocabulary. The other two ways are why this port is worth doing —
re-running a single stage, and opening an agent session in the activity's context and
prompting it directly.

All three answer one question: which stages may start. Keeping that answer in a single pure
place means the whole-pipeline action and a single re-run cannot disagree about whether a
stage is allowed to run.

## Blocks

A stage reports every reason it cannot start, not the first. An author told only "this is
not the canonical ref" would fix that, press the button again, and then be told the
upstream never ran — two round trips to learn what one message could have said.

Three reasons: something it reads has never run, it writes the shared module and this is
not the ref that owns it, or a run is already in flight.

Being *stale* is not a block. Re-running a stage against a changed draft is the point.

## Plan versus instruction

A whole-pipeline plan lists what the run will do, not what it could do this instant. A
stage whose upstream has not run yet stays in the plan, because satisfying it is what the
plan is for; only a block no amount of running can clear — owning the shared module —
removes a stage from it. One run happens at a time per activity, so a pipeline run is a
loop: start the earliest stage that is actually ready, and ask again when it finishes.

## Assist

An assist session carries no stage semantics: no upstream to satisfy and no canonical-ref
rule, because it does not claim to produce any stage's output. The single limit is the
server's own — one run per activity at a time.
