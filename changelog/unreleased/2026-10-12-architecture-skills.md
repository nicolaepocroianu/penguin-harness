# Architecture review skills and a domain glossary

- **Date:** 2026-10-12
- **Type:** process
- **Scope:** `skills`, `docs`
- **PR:** [#115](https://github.com/nicolaepocroianu/penguin-harness/pull/115)

Agents working in this repository now share four third-party skills from mattpocock/skills under
`.agents/skills/`, pinned in `skills-lock.json` and kept as published (excluded from Prettier):
`improve-codebase-architecture` for finding deepening candidates, `codebase-design` for the
architecture vocabulary, `grilling` for stress-testing a plan, and `domain-modeling` for the
glossary and decision records. `penguin-harness-dev` gained an "Architecture reviews" section: the
review's report stays in the OS temp directory, each resulting change is its own PR carrying its
reasoning, candidates are checked against the server kernel contract, the compatibility rule,
prompt-cache byte-identity and `penguin-harness-frontend`, and ADRs in `docs/adr/` are kept for
decisions that are hard to reverse, surprising without context and the result of a real trade-off.
A root `GLOSSARY.md` was added with the activity-authoring terms.
