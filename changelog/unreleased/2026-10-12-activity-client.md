# A typed client and a shared read cache for the activity studio

- **Date:** 2026-10-12
- **Type:** refactor
- **Scope:** `web`

The activity studio got a typed client for one activity's routes, `activity-api.ts`, and a keyed
read cache, `resource-cache.ts`, with a `useResource` hook. The editor shares both with its views
through `ActivityClientContext`.

## Details

- **Routes:** the client builds the activity routes' URLs and types their answers. These cover
  runs (start, accept, cancel, candidate, proposal), draft changes, tests, quality, deploy state
  and clones, the sandbox, the stages, uploads and media stats. A smaller client does the same
  for the project's activity setup (languages, sound, video, speech, ElevenLabs voices).
- **Cache:** concurrent reads of one version share a request, and a read that a newer one
  superseded is dropped. A failed read keeps the last value. `refresh` always reads afresh.
- **Starting a run:** "a run started" became one call, `runStarted`, which puts the run at the
  top of the run history and has the page's poll read it again. The `onStarted` props of the
  tests, quality and conversation panels were removed.
- **Shared reads:** the Tests and Quality chips and their panels read the test report and the
  quality reports through one cache entry, by the same version. The header's QA step and the
  Deploy section share the deploy state entry.
- **Studio draft:** the draft's port became the typed client. `commit`, `change` and `send` take
  a typed call with the draft's revision, and `start` and `acceptRun` take the route's name.
- **Converted views:** the page's setup, upload, deploy, stages and media-stats reads went
  through the client and cache. So did the reads in the book words panel, the assist proposal,
  the sandbox panel, and the run candidates (history, media text, timeline, critique,
  composition).
- **Tests:** an in-memory adapter of the client was added for node tests, along with tests of
  the cache. The draft's tests moved onto the adapter.
