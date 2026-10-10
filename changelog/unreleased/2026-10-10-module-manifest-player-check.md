# A module manifest that lists the player check no longer fails the run

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `server`

When a module agent lists its player check's files (`player-check/acceptance.test.mjs`, the
results) in `module-result.json`, those entries are now dropped instead of failing the run.
They sit beside the module and never ship with it. test18's module run failed this way after
35 minutes, with every player check passing. A path that is refused is now named in the error.
