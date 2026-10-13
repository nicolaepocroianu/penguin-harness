# Stage prompts live in modules of their own

- **Date:** 2026-10-13
- **Type:** refactor
- **Scope:** `server`, `tooling`
- **PR:** [#131](https://github.com/nicolaepocroianu/penguin-harness/pull/131)

Every activity run kind's prompt text moved into a prompt-only module under
`packages/server/src/activities/prompts/` — one per stage that has a prompt: assessment, assist,
composition, critique, image, media-text, module, phonemes, spec, test and timeline. These
modules hold text and nothing else: no imports, and only exported constants that are string or
template literals, joined with `+`, or text templates filled from one `values` parameter. The
modules that held the prompts before now pick the parts a run calls for and fill in the file
names and inputs, under the names they had, so every prompt and staged file stayed byte for byte
as it was (the run-kinds golden is unchanged). A test pins the modules' shape.

The activity bench's recipe surface now takes these modules: a candidate may change the text
inside their string and template literals, and an import, a name, a substitution or a new
statement there is `out_of_surface`, as is any change to the modules that build from them. So a
prompt edit can be scored without being able to change how a run is collected or checked
(decisions 15 and 18).

## Details

- Two parts of the assist prompt stayed in `assist.ts`: the rule and the line saying what the
  author is looking at, which the studio reads back to show the conversation.
- The harness and its runner stayed in `acceptance-harness.ts`; only the prompts describing them
  moved.
