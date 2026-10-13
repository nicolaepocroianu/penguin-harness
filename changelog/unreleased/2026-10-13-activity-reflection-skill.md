# A reflection cycle improves activity authoring one measured change at a time

- **Date:** 2026-10-13
- **Type:** process
- **Scope:** `skills`, `tooling`
- **PR:** pending

`.agents/skills/activity-reflection/SKILL.md` walked a person or an agent through one reflection
cycle: read the outcome ledger through its admin route (with the person's own session), the
bench scoreboard, the dev trials' Traces and the public case statements; state one falsifiable
hypothesis; make one bounded change, either the body of one existing waf-authoring skill or the
text of one stage prompt module (decision 15); check it; score it with `pnpm bench`; and open a
pull request only on a "better" verdict, for a person to review and merge (decision 3). It never
read the private case store, a hidden check or a held-out script, nor authors' edits or assist
messages (decision 7). A dropped or worse change stayed in the conversation and went no further.

`scripts/activity-reflection/check-change.mjs <base> [<head>]` checked such a change before it
was scored or proposed. It refused a file outside the write set, a skill's changed frontmatter
(its name and description sit in the agent's system prefix), a plugin manifest changed beyond its
version, a file added or removed, and any added character a reviewer cannot see: U+200B–U+200F,
U+202A–U+202E, U+2060–U+2064, U+2066–U+2069 and U+FEFF. It printed the change as a word diff
with those characters shown as `<U+XXXX>`, which is how a reviewer reads prompt and skill text.

## Details

- `GLOSSARY.md` gained "Reflection cycle".
- The first real cycle waits for the frozen cases and the decision on a first smoke trial.
