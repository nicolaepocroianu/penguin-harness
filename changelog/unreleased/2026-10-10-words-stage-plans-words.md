# Running every stage records a decodable book's words

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `server`

The words stage now plans a decodable book's words from its text first, with espeak-ng's
sounds, for each language, as the Book words panel's refresh does, and then records them. Before,
it only recorded words already planned, and nothing in the stages planned them, so a decodable
book taken through every stage skipped its words as "no word is waiting" and shipped without
word pronunciations.
