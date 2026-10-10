# An agent critiques a recorded scene

- **Date:** 2026-10-10
- **Type:** feat
- **Scope:** `server`, `web`

The Scene video section (the scene video experiment) has **Critique the recording**. Penguin takes
stills from the newest recording with FFmpeg: the first moment, the middle of each storyboard
frame, and the last. The chosen agent looks at them alongside the storyboard and the scene, and
scores the video from 1 to 5 on:

- story;
- layout;
- readability;
- motion;
- fit for young learners.

It then lists up to eight concrete fixes, the most important first. The studio shows the score
(green from 4), each rubric score and the fixes. Compose again hands the fixes to the composing
agent, together with what the recording's check and the page's lint found, so the scene can be
reworked until it scores well. Only a critique of the newest recording counts.

A critique is kept only with a whole score from 1 to 5 for each of the rubric and at most eight
fixes, and it must list some fix when it scores under 4. An agent whose model cannot read images
says so instead of guessing, and the run fails with what to do: choose a vision model for the
project, or a coding agent that reads images. Example from test16, with the Claude coding agent
as critic: scene 1 scored 3.8 of 5, layout 2. Among its fixes: "the right palm tree stands in the
sea", "the map overhangs the island's edge", and "the chest lid floats above the base instead of
opening on a back hinge".

This is a new run kind, `critique`, started with `POST .../critique-video`. The idea is
open-design's critique loop, its "Design Jury" (Apache-2.0); the rubric and checks are Penguin's
own.
