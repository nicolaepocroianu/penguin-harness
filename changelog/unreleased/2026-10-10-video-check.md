# A final check of every scene video

- **Date:** 2026-10-10
- **Type:** feat
- **Scope:** `server`, `web`

Every scene video a run makes is checked before it is kept, behind the scene video experiment.
This covers both a recording of a composition and a finished video rendered from a timeline.
FFmpeg reads the file back once and reports:

- its length, picture size and frame rate;
- whether it has sound;
- stretches of black picture and of silence;
- its mean and peak loudness.

The check compares that with what the video should be. A recording should match the
composition's length and canvas and have no sound. A finished video should match the timeline's
length and size, have sound when the timeline has any, and have sound wherever a narration
should be speaking. It finds:

- a length off by more than 5% (an error past 25%);
- a picture of the wrong size;
- sound missing, or too quiet to hear;
- a peak close to distorting;
- a narration over silence;
- black picture for half a second or more (an error when nearly all of it is black).

A file FFmpeg cannot read back fails the check. The check never stops a video being kept; a
check that cannot run leaves the video unchecked.

The run keeps the result (`video.check`). The studio shows it under each recording or finished
video: "Checked: nothing wrong found", "needs a look" or "the file could not be read back",
followed by each finding with its times. Once every clip has a file, the journey bar's Media step
asks for a look at any kept video whose check found something to fix.

The check follows OpenMontage's final review of a render, as an idea only; its thresholds are
Penguin's own.
