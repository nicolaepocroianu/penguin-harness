---
name: waf-sequence-from-prose
description: Use when implementing WAF module behavior from natural-language prose in an existing module where `definition.json` and any needed configuration files already exist. Focus on authoring `src/sequence.js` and optional helper files for scene flow, media timing, interactivity, hints, and cleanup, while explicitly avoiding assessment-driven APIs and response-submission logic.
---

# WAF Sequence From Prose

Use this skill when the user wants behavior implemented for an existing WAF module from prose and the module already has its `definition.json`, layout, style, and any needed configuration files.

Do not use this skill for creating a new definition, generating assessment content, or wiring assessment submission flows.

## What To Build

Default output:

- `src/sequence.js`
- optionally `src/helpers.js`
- preserve `src/preview-start.js` when the scaffold provides it
- optionally `src/common/*` for reusable behavior utilities
- optionally update layout/css styles

Pipeline-generated modules now start with scaffolded `src/sequence.js`, `src/helpers.js`, and `src/preview-start.js`.
Prefer refining those scaffolded files over replacing them wholesale.
If the scaffold already includes stage metadata constants, named middleware placeholders, or audio helper exports, reuse them when they still fit the behavior.

Do not edit these unless the user explicitly asks:

- `definition.json`
- configuration JSON
- assessment JSON

## Forbidden Patterns

Stay out of assessment-driven flows for this skill. Do not introduce or depend on:

- `awaitAssessmentItemOrComplete`
- `assessmentItem`
- `simpleChoice`
- `associate`
- `itemScoreId`
- `exitIfCompleted`
- assessment service events

If the existing module still contains old assessment code, replace only the behavior the user asked for and keep the new implementation prose-driven.

## Preflight

Before editing, inspect the module inputs and resolve concrete names from the real files:

1. Read `res/layout.html` and capture the root element id.
2. Read `res/style.scss` and note reusable classes, layout constraints, and z-index assumptions.
3. Read `definition.json` and list the asset keys and any theme properties the behavior can use.
4. Read existing configuration JSON if present and extract any scene timing, positions, or copy that the sequence should consume.
5. Read existing `src/sequence.js`, `src/helpers.js`, `src/preview-start.js`, or `src/common/*` so the new behavior matches local conventions before replacing logic.

Never invent asset keys when the module already has a definition. Match the real keys.

## Turn Prose Into Sequence

Translate the prose into an ordered scene plan before writing code.

For each scene, extract:

- entry actions
- visible elements
- narration or audio cues
- learner actions
- timeout or hint behavior
- success condition
- failure or retry behavior
- cleanup boundary

Then map those scenes to named middleware. Prefer small named functions over long inline blocks.
Make sure to follow the order of the scenes as provided.

Good middleware categories:

- initialize data
- initialize elements
- render background or scene shell
- create interactive elements
- play intro or instruction audio
- wait for input
- play hint or scaffolding
- transition to next scene
- play outro

When preserving or refactoring scaffolded preview-start support, keep `data.configuration.__loomPreview.startSceneId` dev-only and use the `src/preview-start.js` helpers instead of recreating the same state helpers inline in `sequence.js`. Keep scene middleware in ordered scene groups passed through `createPreviewStartSequenceSteps`; do not add per-scene skip guards to scene runner functions. Unknown or absent scene ids should start normally. Valid scene ids should start at the requested scene group suffix, and each scene entry should initialize the state it needs to render directly.

## Sequence Shape

Build the behavior as a `new Sequence([...])` pipeline where top-level steps represent scene transitions and nested arrays represent repeated interaction loops.

Use these repo patterns:

- bind `view.elements.root` early from the layout id
- initialize all scene state on `data`
- create DOM nodes with `htmlToElement`
- attach them with `view.render`
- clean up scene-specific DOM with `view.remove` or `view.removeAsMiddleware`
- finish with outro behavior and `endActivity`

Use nested arrays only when the prose actually implies a loop, such as:

- instruction -> wait -> hint -> wait
- render scene -> repeated clicks until condition is met
- timed guidance that can repeat until the learner acts

Keep scene transitions obvious. A reader should be able to scan the final `Sequence([...])` and see the story of the activity.

## State Rules

Prefer prose-driven local state in `data`.

Typical local state:

- current scene id
- selected item ids
- click counts
- hint count
- flags like `isGuiding`, `activityFinished`, or `sceneComplete`
- cached element handles or animation instances

Keep state names literal and scene-oriented. Avoid generic names when the prose is specific.

## Media And Timing

Use existing `data.assets`, theme properties, and configuration data as the source of truth for media. Treat generated images, animations, and videos as configuration-backed runtime media, not as preloaded `data.assets` entries.

Prefer these patterns:

- `setBackground(...)` for scene backgrounds
- `createAudioEvents(...)` when choreography depends on audio completion
- repeat-audio helpers for reminders
- timers only when the prose requires delayed reveals or scaffolding
- `Animation` only when the existing assets or module style already use it

If a scene uses CSS or Web Animations API motion (`@keyframes`, CSS transitions, or `element.animate(...)`), wire it to `EVENTS.activity.pause`/`EVENTS.activity.resume` so it pauses with the activity. The framework does not pause CSS animations automatically. See the CSS animation pause/resume pattern in `waf-sequence-implementation-patterns`.

Map every prose media cue to a real asset or config field before coding. If the prose mentions media that the existing files do not expose, stop and surface that mismatch instead of inventing it.

### Prose timing cues for sound effects

Infer the intended relationship between a sound effect and nearby animation or video from
the complete scene meaning, not from a fixed keyword list or tag position. When the sound
belongs to the motion, run it **concurrently** with that motion (fire-and-forget or
`Promise.all`), never as a second `await` after the motion has finished. When it belongs to
the following beat, keep it sequential. See the "SFX must play with the animation it
accompanies" pattern in `waf-audio-patterns`.

## Asset-First Rendering

When a stage has visual assets, render the scene from those assets.

- use background image assets for scene backgrounds
- use image assets for characters, props, frames, and other artwork
- use configuration-backed animation and video keys through the real WAF media helpers

Do not recreate provided visuals with gradients, borders, pseudo-elements, decorative wrappers, or generated text labels.

HTML and CSS should still provide structure and interaction:

- layout
- positioning
- hit areas
- highlight states
- spacing
- visibility changes

If the prose expects a visible object but the available module files do not expose a matching asset key, stop and surface that mismatch instead of drawing a substitute scene in HTML/CSS.

## Interactivity Rules

Use `Interactable`, `inputManager`, and `waitingForInput` to model learner actions.

Match the input event type to the prose exactly:

- `tap`, `click`, `press`, or equivalent normal selection language => `inputEventTypes.CLICK` with `onClick`
- `press and hold`, `hold`, `long press`, or equivalent delayed-confirm language => `inputEventTypes.SELECT` with `onSelect`

Do not use `SELECT` for a normal tap interaction. If the prose says a learner taps a character, card, button, or hotspot, wire it as a click interaction unless the prose explicitly says the learner must hold it.

Preferred interaction flow:

1. Render the clickable or selectable elements.
2. Register interactables with named handlers.
3. Lock input while one-shot audio or animation feedback is running.
4. Unlock only when the scene is ready for the next learner action.
5. Exit the loop or advance the scene only from explicit success conditions.

If the prose includes hints or scaffolding:

- keep the primary interaction flow separate from the hint logic
- trigger hints from timeouts or attempt counters
- prefer highlighting, repeat audio, or guided focus before adding new UI

## Input Wait Patterns

`waitingForInput` is only a timeout and activity-state signal. It does not by itself move the sequence forward.

If a loop uses `waitingForInput`, the next middleware in that loop must still be reachable through a real `next()` path from the current scene logic.

For simple tap or click scenes, prefer the repo pattern:

1. render interactables
2. unlock input when the learner should act
3. interactable handler records the learner selection and calls `next()`
4. sequence middleware processes the selection
5. loop exit middleware decides whether to continue or advance

Do not combine `waitingForInput` with ad hoc polling helpers like `waitForCondition(...)` for simple tap or click flows. That pattern is fragile and can leave the sequence waiting forever even though input was received.

Only use polling-style wait helpers when the prose truly implies waiting on non-interactable state, such as a timer, animation-complete flag, or asynchronous external state that is not driven by a simple learner click.

## Helper Extraction Rules

Keep `sequence.js` focused on orchestration.

If the generated scaffold already includes `resolveAudio`, `playAudioKey`, or `setRepeatAudioForKey`, build on those helpers instead of creating a second competing audio utility layer.

Extract to `helpers.js` or `src/common/*` when logic is:

- reused across multiple scenes
- mostly math or positioning
- mostly DOM utility code
- mostly timing or repeat-audio plumbing
- mostly animation setup or highlight behavior

Keep in `sequence.js` when logic is:

- specific to one scene
- easier to understand inline as part of the activity flow
- primarily deciding when to advance, hint, or finish

Good helper examples:

- building repeated interactable items
- computing highlight targets
- repeat-audio setup
- reusable timer wrappers
- animation factory utilities

## Reference Patterns

Use the existing modules as style references, not as templates to copy blindly.

`waf-module-vt1additionsentencespractice`

- good reference for scene cleanup, repeat prompts, and helper extraction for interaction-specific utilities

`waf-module-vt1amphibians`

- good reference for multi-scene choreography, media transitions, and mixing render/play/wait/cleanup stages

`waf-module-vt1rhymeinstruction2`

- good reference for lean scene middleware, button creation, and timeout-driven guidance without over-complicating the top-level sequence

Reuse the patterns that fit the prose. Do not inherit their assessment code.

## Output Expectations

The final implementation should usually leave:

- `src/index.js` unchanged except for supported bootstrap options required by
  the behavior, such as `beforeHydrate` for a video-first activity
- `src/sequence.js` readable as a stage-by-stage script
- helper files small and purpose-built

When you finish:

- verify every referenced asset/config key exists
- verify every major scene visual uses a declared asset key when one exists
- verify every rendered element is removed or reused intentionally
- verify input locking always has a clear unlock path
- verify the final sequence has a clear end state via `endActivity`

## Minimal Recipe

Use this checklist when writing:

0. Make sure than any asset keys you use in the code are actually available in the theme under definitions.json
1. Resolve module inputs from layout, style, definition, and config.
2. Rewrite the prose as ordered scenes.
3. Name the middleware needed for each scene.
4. Build the top-level `Sequence([...])`.
5. Implement scene entry, interaction, hint, and cleanup middleware.
6. Extract reusable utility logic if the same pattern appears more than once.
7. Validate assets, cleanup, input locking, and end-of-activity behavior.
8. Do not use optional chaining (`?.`) or nullish coalescing (`??`) in module source.
9. Do not place any text on any screen of the activity unless explicitly instructed to.
