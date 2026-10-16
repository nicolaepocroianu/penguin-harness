# The player at the centre of the Activity Studio

- **Date:** 2026-10-16
- **Type:** feat
- **Scope:** `web`, `server`

Preview that fills the workspace is now Play mode. The player takes the middle, up to twice its
own size. Under it are restart, the scene before and after, and a timeline of the activity's
scenes. Each scene shows its picture and is as wide as its narration is long; choosing one plays
the activity again from there. Beside the player are the scene's narration lines. The line being
said is lit, with its word marked and its waveform filling as it plays. A line in words says
what can be tapped now ("Tap First rock or rock-c", "Nothing to tap while the narrator
speaks") in place of "Now in scene-2.presenting". The behavior map sits under the lines. Preview
beside the work gets the same timeline and lines in one column.

The lit line comes from the module itself. The player page now passes on the framework's own
record of each clip it starts and ends (the asset key and what happened), under the same checks
as the state reports. A module that never reports its clips lights no line, and the player says
so. Nothing new is stored.

The Script and the player stay in step. The line being said is lit in the Script as it plays. A
click on a narration line lights it in Preview's list, and choosing a line there lights it in the
Script and scrolls to it. Neither restarts the activity. A narration chip with a file plays where
it is written, and a video chip opens a small player over the script's corner. A placeholder
never plays the stand-in clip.

The behavior map now finds the state machine of a generated module, which keeps its
configuration under its product code.

New ref and Library tables lay out one row per asset when a side panel leaves them too narrow,
so keys no longer break one letter per line. New ref's fields fold by the page's width rather
than the window's, and its rows lead with what the asset says or shows. The Library gains a grid
of tiles with pictures, waveforms and play buttons, with what needs a file first. A Grid/Table
switch is kept per browser. Audio rows draw their waveforms, and Audio gets Play all. Waveforms
are decoded in the browser from the file each line plays; nothing is stored.

Creating an activity starts with "What should the learner do?", which becomes the first lines of
the script. The create request takes an optional `description` for it. The product code has a
hint, and the ref number is filled in with the next free one as the code is typed, from a new
read-only `GET …/activities/ref-number?productCode=`.

The activity list is denser: one row per ref under a thin product header, with lenses for All, In
progress, Needs you and Built. Each row shows the activity's picture: the first scene's picture or
video with a real file, named by a new `poster` in the list summary and decoded in the browser.
The stand-in clip is passed over. New ref moves from a card on every product into each row's
menu.
