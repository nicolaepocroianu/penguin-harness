# Coding-agent Sessions record their tokens and the cost the agent reports

- **Date:** 2026-09-23
- **Type:** feature
- **Scope:** `coding-agents`, `core`, `server`

A coding agent's Session now counts in usage and cost like any other. ACP agents report what each turn used (the prompt response's input, output, cached and thinking tokens) and, when they price their own work, a running cost for their session; both used to be dropped. Each turn now records a `token_usage` in the Session's Trace with the tokens and the part of the agent's running cost that turn added, and the usage records keep that cost, since no Project pricing exists for a coding agent to compute it from.

## How cost is counted

- A turn is charged what the agent's running cost grew by since the last charge. A reopened Session continues from what its Trace already charged when the agent resumed the same session; when it had to start a fresh agent session, whose own count starts at zero, it starts again.
- Cost queries use a model's Project pricing when it has one, and otherwise the cost its runner reported. A coding agent whose turns reported no cost is marked uncosted, as an unpriced model is; one that reported cost for only some turns is marked incomplete.
- Costs are kept in USD. A cost reported in another currency stays in the Trace but is not counted.
- Measured on OpenCode 1.18 (2026-09-23): a one-line turn reported 27,450 input, 16 output and 1,792 cached tokens, and its free model a running cost of 0 USD.

## Data

- Migration 19 adds one nullable column, `usage_records.reported_cost_usd`. Existing records, and every record a core Session writes, leave it empty. It is swap-safe, and its down removes the column and keeps the tokens.
- `token_usage` gained an optional `reported_cost` (`{ amount, currency }`); core Sessions never set it.
- The kernel's `turn_end` event carries the turn's `usage`, and its `usage` event the agent's running `cost`; `AcpConnection.prompt` resolves with `{ stopReason, usage? }`.
