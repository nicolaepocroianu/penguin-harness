# Improve tries a failed agent step once more

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `activities`

Improving a scene stopped as soon as one of its steps failed. On test16, an agent's connection
dropped mid-turn and ended an Improve before its first recording. Now when composing or critiquing
fails, Improve tries that step once more, and stops only if the retry fails too. A failed recording
still stops it, since recording again would fail the same way. Improve now has a server test that
drives it end to end: a failed first composition, then two rounds, stopping once a critique scores
the scene 4 or more.
