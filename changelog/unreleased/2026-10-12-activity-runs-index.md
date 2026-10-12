# Activity panels read one runs index

- **Date:** 2026-10-12
- **Type:** refactor
- **Scope:** `web`

The activity studio's panels stopped working out "the newest run of this kind" each for
themselves. A runs index (`features/activities/runs-index.ts`) was added, built once per runs
list, that orders runs newest first by `createdAt` and then `runId` (the order the server lists
them in), knows where each kind keeps the language and asset it works on, and answers which
runs of a kind belong to a target, the newest of them, and what is under way.

## Details

- Removed `latestModuleRun`, `latestConversation`, `latestTestRun`, `latestQualityRun`,
  `latestPhonemesRun`, `cardGenerating`, `compositionRuns`, `videoRuns`, `refineRuns` and
  `critiqueRuns`; their callers ask the index.
- `playingModuleRunId`, `conversationThreads`, `newestTake`, `pendingText`, `testBlocked`,
  `checkBlocked`, `speechStatuses`, `speechTally`, `pendingSpeechKeys`, `soundStatuses`,
  `soundTally`, `pendingSoundKinds` and `storyboardFrames` took the index in place of the runs
  array and kept their own rules.
- The asset editor's audio, image and text candidates, the audio card's last failure, the
  composition view's look and critique scores, and the page's running chip, busy flag and
  module check read the index.
- A run the page adds to the front of the list as it starts no longer counts as the newest
  previewable module, the running chip's run, or the first image or text candidate unless it
  started last; every panel orders by start time.
- Tests of the removed helpers were replaced by tests of the index.
