# The words stage asks the agent for sounds espeak-ng cannot give

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `server`

When a decodable book's words have no sounds after planning, because espeak-ng could not sound
them out or is not installed, the words stage now starts the same sounds run the Book words
panel's "ask the model" button does, accepts what it proposes, and records the words that then
have sounds. Before, a machine without espeak-ng skipped every word as missing its sounds, so a
decodable book taken through every stage shipped with no word pronunciations.

The sounds are asked for in runs of at most 200 words until every word has been asked about,
and a run scoped to one word asks only about that word. Stop now takes effect before the next
run in every stage that starts one run after another (speech, images, word sounds, word
recordings), not only between stages.
