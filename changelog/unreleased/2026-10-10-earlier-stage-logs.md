# Earlier stage runs keep their conversations

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `activities`

The Stages panel found each stage's conversation through the activity's newest 50 runs, while it
lists the last 20 sequences. Media stages start many runs, so an earlier sequence's runs could drop
out of the 50 while the sequence was still listed, and its stages lost their conversation links.
Each stage now records the session of its latest run, and the panel reads that first. Sequences
recorded before this still fall back to the runs.
When a session is rebuilt after a restart, the stage history now records the new session too,
and a run still among the recent ones names its current session first.
