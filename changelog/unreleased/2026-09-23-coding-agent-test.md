# Test a coding agent from Models → Local CLI

- **Date:** 2026-09-23
- **Type:** feature
- **Scope:** `server`, `web`

A selected coding agent's card has a **Test** button. It starts the agent with its remembered model and settings in a throwaway workspace, asks it to reply with only the word "ok", and shows the outcome under the card: how long the answer took and what it was, or why the test did not pass — the agent could not be started (with its reason), did not answer in time, ended its turn in error or refusal, or answered something other than ok (quoted). "OK." counts as ok.

## Details

- `POST /api/coding-agents/agents/:agentId/test` (admin only, since it runs the agent) answers `{ ok, ms, reply, failure?, message? }`; `timeoutMs` (500–120000, default 60000) bounds the whole test, including an agent that never answers.
- Anything the agent asks permission for during the test is refused: nobody is there to answer, and a test must not act.
- The test's session and workspace are removed afterwards, whatever the outcome.
