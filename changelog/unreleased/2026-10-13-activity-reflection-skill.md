# A reflection cycle improves activity authoring one measured change at a time

- **Date:** 2026-10-13
- **Type:** process
- **Scope:** `skills`, `tooling`
- **PR:** [#132](https://github.com/nicolaepocroianu/penguin-harness/pull/132)

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
version, a file added or removed, and any added character a reviewer cannot see: every Unicode
format, control, private-use and line- or paragraph-separator character (soft hyphen, zero-width
and direction characters, the tag block), and the invisible marks and fillers beyond them
(variation selectors, the combining grapheme joiner, Hangul fillers); tab, line feed and carriage
return excepted. It printed the change as a word diff with every such character shown as
`<U+XXXX>`, in the changed lines and the lines around them, which is how a reviewer reads prompt
and skill text.

## Details

- The change the bench scores is the cycle's first commit, with the plugin's version raised for a
  skill change; the changelog entry, and for a prompt change the refreshed run-kinds golden, come
  in a second commit outside the bench's surface. The pull request names the scored commit and
  the evaluation id, and re-scoring means benching that commit, never the pull request's head.
- `GLOSSARY.md` gained "Reflection cycle".
- The first real cycle waits for the frozen cases and the decision on a first smoke trial.
