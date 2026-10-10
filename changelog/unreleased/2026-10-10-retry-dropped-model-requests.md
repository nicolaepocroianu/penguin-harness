# A dropped model request is retried

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `core`

A model request answered with HTTP 499 is now retried like a network drop instead of ending the
Session. A proxy in front of the model, such as GitHub Copilot's, uses 499 when the connection
closed before the request finished, so the request itself was never judged. Before, one 499
ended an activity's module stage after 15 minutes of work.
