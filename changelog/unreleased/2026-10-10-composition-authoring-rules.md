# Scene compositions get layout, text and motion rules

- **Date:** 2026-10-10
- **Type:** feat
- **Scope:** `server`

The agent that composes a scene video (the scene video experiment) is now told how to make it for
young learners watching on a small screen:

- **Lay it out first.** List each main object's box in a comment, give each its own space, keep
  clear space around the main object, its glow and its sparkles, and position with left and top.
  Keep everything inside the stage.
- **Text** is at least 28px, in one system font, with 4.5:1 contrast, on screen for at least
  2 seconds.
- **Motion** uses only transforms and opacity. It uses fromTo where an element starts elsewhere,
  a transform origin on everything that rotates, no endless repeats, eased entrances and exits,
  and bounces only for playful moments.
- **Timing.** One idea per frame, a clear still picture at the start and the end, and a timeline
  exactly as long as its frames say, holding the last picture when the animation ends sooner.
- **Self-check.** Before finishing, check the main objects' boxes across each frame for overlaps.

The rules follow the authoring guidance in HeyGen HyperFrames' agent skills (Apache-2.0),
rewritten for young learners and Penguin's own composition bridge. On test16, the first
composition of scene 1 put the treasure chest on top of a palm tree; composed again with these
rules, the chest has its own space.
