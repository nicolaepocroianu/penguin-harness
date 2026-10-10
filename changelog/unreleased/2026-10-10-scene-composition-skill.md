# A scene composition skill

- **Date:** 2026-10-10
- **Type:** feat
- **Scope:** `plugins`, `server`

The waf-authoring plugin has a new skill, `waf-scene-composition`: how to compose an animated
scene for a video asset. It is written as a director's process, as OpenMontage's pipeline
directors are: storyboard first, plan the stage, build, animate, time, check, then score and
submit. It covers:

- layout: each main object in its own space, standing on its ground, marked `data-focal`;
- text and colour for young learners;
- motion: transforms only, easing conventions, no endless repeats;
- timing the timeline to its frames;
- fixing what the last recording's check found;
- a self-score before finishing and common pitfalls.

The rules adapt HeyGen HyperFrames' authoring skills. Both sources are used as ideas only.

A scene composition run now stages the skill as `scene-composition-skill.md` and tells its agent
to follow it. The rules that were written into the run's prompt now live in the skill alone. The
plugin is now 0.2.14.
