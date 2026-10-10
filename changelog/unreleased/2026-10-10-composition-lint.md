# Compositions are read for trouble before they are recorded

- **Date:** 2026-10-10
- **Type:** feat
- **Scope:** `server`, `web`

When an agent finishes composing a scene (the scene video experiment), Penguin reads the page's
source for what will look wrong to a young learner or break a frame-by-frame recording:

- randomness or the clock;
- the page's own timers or animation frames;
- movements that repeat forever;
- tweens of width, height, top or left;
- emoji, which look different on every machine;
- text in capitals;
- text set smaller than 28px;
- filler copy such as lorem ipsum.

Each kind is reported once, with the piece of source it was found in. The findings are kept with
the composition and shown under its frames as "Read from the page". Compose again hands them to the
agent to fix, together with what the last recording's check found. None of them stops the
composition being kept.

The approach follows open-design's artifact linter (Apache-2.0). Its rules there are for marketing
pages; these are Penguin's own for scenes, with the filler and emoji checks adapted from it. None of
the seven compositions agents wrote for test16 was flagged.
