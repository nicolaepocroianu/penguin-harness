# Which behaviour path an activity is on

- **Date:** 2026-09-22
- **Type:** feat
- **Scope:** `server`

Measuring the real corpus said 299 modules are built on `src/sequence.js` and 4 on the
state machine, which read as a choice: serve new work, or serve everything already
authored.

It is not a choice. Loom decides **per activity** — it looks at what the module on disk
actually contains and picks a different skill set accordingly. So this is a port, and both
skill sets were restored in the authoring plugin precisely because the corpus needs them.

## The rule, as Loom has it

An explicit scaffold override wins. Otherwise a module is on the old path when it has
`src/sequence.js` and **no** `src/index.ts`.

The second half matters: a module part-way through migration has both, and treating it as
legacy would hand the agent the wrong contract for code that has already moved.

## The skills a run reads

The framework overview opens the list, the behaviour skill goes second, then the pattern
skills. That ordering is Loom's and it matters, because the agent reads them in order and
the overview is what makes the rest legible.

An assessed activity gets the assessment skill as its behaviour skill instead of the
path's own. On the machine path nothing is lost — the state-machine contract is already in
the shared list. On the sequence path it means an assessed activity is told how to wire
assessment rather than how to write prose sequences, which is the harder of the two.

Duplicates are dropped while keeping first position, so the state-machine skill — which is
both the machine path's behaviour skill and one of its shared skills — appears once.

## Missing skills are named

A run that proceeds without the state-machine contract writes code against an API the
agent had to guess at, and the failure then looks like a broken activity rather than a
missing skill.
