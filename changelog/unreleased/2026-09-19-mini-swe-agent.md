# mini-swe-agent coding plugin

- **Date:** 2026-09-19
- **Type:** feature
- **Scope:** `skills`, `core`, `cli`, `desktop`, `docs`
- **PR:** [#7](https://github.com/nicolaepocroianu/penguin-harness/pull/7)

[中文版](2026-09-19-mini-swe-agent.zh.md)

Added the opt-in `use-mini-swe-agent` plugin to the agent plugin library.

## Details

- Shipped a coding skill and Python runner pinned to mini-swe-agent 2.4.6, with explicit workspace, model, task file, and positive run limits.
- Saved trajectories and result summaries in a fresh directory for each run; reported non-submission exits as failures.
- Documented provider credentials, WSL execution on Windows, and review of delegated changes.
