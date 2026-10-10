# An agent refines a scene video's timeline

- **Date:** 2026-10-10
- **Type:** feat
- **Scope:** `server`, `web`

The Timeline section of a scene video (the scene video experiment) has **Refine with agent**.
The chosen agent reads the video's timeline, the storyboard frames its recording shows with when
each starts and ends, and the scene's narration (scripts and lengths), music and sound effects.
It writes the timeline again so the sound follows the picture: each narration over the frame it
talks about, never overlapping another and ending before the video does; effects where the frames
show them; music from the scene's list, turned down under narration.

Penguin keeps what it writes only when it is a well-formed timeline that:

- keeps the video's size and frame rate;
- cuts only from the recordings it was given;
- names only the scene's own audio.

Nothing is saved on the video. **Load the agent's timeline** puts it in the editor, where the
author looks it over and saves it. A refinement that fails says why.

This is a new run kind, `timeline`, started with `POST .../refine-timeline`. On test16's scene 2,
the agent moved "Each treasure is a letter" to 3.2 s, where the frame about the letters begins, and
"Look at the stones…" to 7.3 s, as the stones rise.

The idea is OpenMontage's edit stage (its "edit director"), as an idea only.
