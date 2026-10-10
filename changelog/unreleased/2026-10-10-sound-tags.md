# `<sound>` and `<music>` tags are no longer dropped

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `server`

A description's `<sound>...</sound>` and `<sfx>...</sfx>` tags now reach the spec stage as
one-shot `<audio kind="sfx">` tags, and `<music>...</music>` as looping
`<audio kind="music" loop="true">`. The spec stage is told only `<audio>`, `<image>`,
`<animation>` and `<video>` count, so it dropped those tags without a word, and the activity
quietly lost its music and sound effects. The rewrite applies to what a run is given; the
author's saved description is left as written.
