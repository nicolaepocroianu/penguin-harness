---
name: waf-scene-composition
description: Use when composing an animated scene for a WAF activity's video or animation asset (Penguin's scene composition, an HTML page driven by one paused GSAP timeline). Covers planning the frames, laying out the stage, text and motion for young learners, timing against the storyboard, and checking the result before finishing.
---

# WAF Scene Composition

Use this skill when you write `composition.html` and `frames.json` for a scene video. The page
is recorded frame by frame: Penguin pauses the timeline, seeks it to each frame's time,
screenshots the stage and encodes the frames to an MP4. The page must be deterministic and look
right at every moment, not only while it plays.

The process follows the "director" skills of OpenMontage's explainer pipeline (plan, make,
check, score, submit). The layout, text, motion and self-check rules follow HeyGen HyperFrames'
authoring skills. Both are adapted here as ideas for young learners and Penguin's composition
bridge; no code comes from either.

## Before you start

Read `composition-input.json`. It holds:

- the scene's description and the video's own description;
- the canvas size and the staged images, if any;
- `previousRecordingFindings`, when the scene was recorded before.

Each of those findings is something the last recording got wrong. Fix every one.

A scene with no images is drawn entirely with HTML, CSS and inline SVG.

## Process

1. **Storyboard first.** Split the video's description into frames of about 3 seconds, one idea
   per frame, and write them to `frames.json`. The frames' seconds add up to the video's length.
2. **Plan the stage.** In a comment at the top of `#stage`, list each main object with its box
   in stage pixels (left, top, width, height). Give each main object its own space, and keep at
   least 24px of clear space around the scene's hero object, including its glow and sparkles.
   Scenery (ground, island, sea, sky, background) is not a main object, and objects stand on it.
3. **Build it.** Position with `left` and `top`, never a mix of `right` and `bottom`. Mark each
   main object with `data-focal`, and an element meant to sit over another (a glow behind its
   chest) with `data-allow-overlap`. Penguin measures the marked objects while it records.
4. **Animate it.** Use one timeline created paused, assigned to `window.__composition.timeline`,
   and drive every change from it.
5. **Time it.** Make the timeline exactly as long as the frames add up to. When the motion ends
   sooner, hold the last picture, for example `timeline.to({}, { duration: 0.8 })`.
6. **Check it.** Check the boxes of the main objects at the start, middle and end of each frame.
   Fix any overlap you did not intend, anything leaving the stage, and any text that is too small.
7. **Score it and submit.** Score it with the self-score below, then finish.

## For young learners on a small screen

- Text is at least 28px, in one font from the system font stack, with contrast of at least 4.5:1
  against what is behind it. It stays on screen for at least 2 seconds.
- Use one clear focal colour per scene. Decorative layers stay quiet, around 12–25% opacity.
- Everything stays inside the stage, at least 16px from its edges, at every moment.
- The first and last moments of the timeline are each a clear, still picture.

## Motion

- Animate only transforms and opacity: `x`, `y`, `scale`, `rotation`, `opacity`. Never animate
  `width`, `height`, `top` or `left`.
- Use `fromTo` when an element starts somewhere other than where its CSS puts it. Never set a CSS
  `transform` and tween the same property.
- Give everything that rotates a `transformOrigin`.
- Easing:
  - Entrances ease out: `power3.out`, about 0.6 s.
  - Exits ease in.
  - Ambient movement uses `sine.inOut`.
  - Bounces (`back`, `elastic`) are only for playful moments.
  - Stagger groups at about 0.08 s.
- No `repeat: -1`, no `Math.random`, no `Date.now`, no timers or event handlers of your own.
  A pulsing element needs clear space at its largest.

## Self-score before finishing

Score each from 1 to 5. Revise anything below 3:

- Does each frame show its one idea clearly, matching `frames.json`?
- Does every main object have its own space, standing on its ground, with nothing floating?
- Is all text large and clear enough for a young learner?
- Does the motion help the story rather than decorate it?
- Is the timeline exactly as long as the frames, with still pictures at both ends?

## Common pitfalls

- **Objects in the same place.** An object positioned with `right`/`bottom` lands in the same
  place as one positioned with `left`/`top`. Plan the boxes first.
- **Floating objects.** Moving objects apart by lifting them off the ground leaves them floating.
  Move them along their ground instead.
- **Timeline shorter than the storyboard.** The recording then runs short of what the frames
  promise.
- **Network loads.** Loading fonts or scripts from the network fails: only staged files load.
