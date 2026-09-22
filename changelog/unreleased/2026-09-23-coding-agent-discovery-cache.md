# Restore two coding-agents declarations lost in a merge

- **Date:** 2026-09-23
- **Type:** fix
- **Scope:** `server`, `web`

The merge that brought the open-design ports into main dropped the declaration of the discovery cache on the coding-agents service while keeping the code that reads and writes it. The server no longer typechecked, and at runtime the unset field read as `undefined`, which the `!== null` guard let through, so the first discovery read failed on `undefined.at`. The declaration is restored as it was on the branch.

The same merge dropped the `AgentCardModel` interface from the Web App's coding-agents screen while keeping its five uses, so the web package no longer typechecked either; it is restored as it was on the branch.
