# Book modules no longer stall on their first state

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `server`

The book state machine every book scaffold ships now puts the reader in `reading.ready`
instead of a bare `reading` state. waf-state-machine reports each state as
`<scene-id>.<phase>` and throws `Invalid activity state "reading"` for anything else, so every
book module stalled as it started. A module agent that fixed the machine had its module refused,
because a book's state machine must ship as the scaffold wrote it: test23's read-along book
failed this way after 12 minutes, with its player checks passing. Book modules assembled before
this keep the old machine until they are assembled again.
