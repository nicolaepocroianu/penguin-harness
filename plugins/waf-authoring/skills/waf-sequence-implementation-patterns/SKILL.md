---
name: waf-sequence-implementation-patterns
description: Use when implementing `src/sequence.js` for pipeline-generated WAF HTML modules. Follow the concrete middleware, interactivity, input-handoff, repeat-audio, and cleanup patterns already used by the working WAF sequence modules in this repo.
---

# WAF Sequence Implementation Patterns

Use this skill when authoring or editing `src/sequence.js` for a pipeline-generated WAF HTML module.

This skill complements `waf-sequence-from-prose`. That skill helps turn prose into scenes. This skill defines how the final `sequence.js` should be structured and wired.

## Core Structure

Write `sequence.js` as named middleware functions.

Pipeline-generated modules may already include stage metadata constants, scaffolded middleware placeholders, a small `src/helpers.js` audio/scene utility layer, and a `src/preview-start.js` dev-preview utility layer.
Treat that scaffold as the starting architecture and refine it, rather than collapsing it into a new ad hoc structure.

Prefer:

- one function per scene step
- explicit names like `initializeData`, `renderScene`, `playPrompt`, `waitForSelection`, `handleCorrectSelection`, `cleanupScene`
- a top-level `new Sequence([...])` that reads like the activity story

Avoid large inline anonymous middleware blocks unless the step is tiny and obviously local.

## Sequence Shape

The top-level sequence should be easy to scan in order:

1. initialize data and elements
2. render the first scene shell
3. play intro or prompt media
4. wait for learner input
5. branch into feedback, hint, retry, or success
6. clean up the current scene
7. play outro if needed
8. finish with `endActivity`

Use nested arrays only for real loops or subflows:

- repeated learner interaction until success
- prompt -> wait -> hint -> wait
- timeout-driven scene loops

Do not use nested arrays as a bucket for unrelated steps.

Keep completion explicit in sequence logic.

- evaluate success in middleware, not inside a click handler
- use loop-exit middleware with `exit()` when a repeated interaction phase is complete
- let the top-level sequence continue into cleanup, outro, and `endActivity`

Do not end an activity by hiding completion control flow inside saved callbacks, pending `next` references, or click-handler-only success branches.

## Dev Preview Start Scene

Pipeline-generated modules may receive a dev-only preview hint at `data.configuration.__loomPreview.startSceneId`.
Preserve that convention when refining scaffolded code. Use the scaffolded `src/preview-start.js` helpers (`initializePreviewStart`, `createPreviewStartSequenceSteps`, and `isPreviewStartScene`) instead of redefining preview-start state helpers inline in `sequence.js`. Keep scene middleware in ordered scene groups for the preview router instead of adding skip guards inside individual scene runner functions.

- read the hint during initialization
- treat unknown or absent scene ids as normal start-from-beginning behavior
- skip only complete scene blocks before the requested scene
- keep each scene entry self-contained enough that rendering from that scene does not require earlier scene DOM or one-time side effects
- do not persist this hint into module configuration JSON or activity spec files

## Element And State Setup

Bind `view.elements.root` early using the real root id from `res/layout.html`.

Store reusable scene handles in:

- `view.elements` for DOM handles
- `data` for scene state, counters, cached interactables, cached media handles, and branch flags

Use literal, behavior-specific names in `data`. Prefer:

- `incorrectAttempts`
- `selectedDayNumber`
- `activityFinished`
- `choiceItems`
- `interactionResult`

Avoid vague names like `state`, `value`, or `itemData` when the scene has a clearer noun.

Assign a stable DOM `id` to every meaningful element as you create it, before it is appended, following `waf-element-ids`. Use the layout root id only for the mount lookup, give structural shells plain descriptive ids, and give dynamic/content elements a stable natural-key id so interaction telemetry stays attributable.

## Rendering And Cleanup

Create scene DOM with `htmlToElement(...)` and attach it with `view.render(...)`.

Use:

- `view.render(root, { scene })` or equivalent named handles
- `view.remove(...)` for direct cleanup
- `view.removeAsMiddleware(...)` when a rendered group should be removed as part of sequence flow

Every rendered scene or helper wrapper should have a deterministic cleanup boundary.

Prefer the generated-module cleanup style of an explicit cleanup middleware or `view.removeAsMiddleware(...)` over hidden cleanup side effects.

Use asset-backed rendering for scene artwork.

- apply backgrounds from asset keys
- apply object, frame, and prop images from asset keys
- keep CSS focused on layout and state styling

Structural wrappers are fine. Decorative wrappers that replace real scene artwork are not.

When the module UI is supposed to fill the visible player area, make the root selector in `res/style.scss` use absolute inset positioning:

- `position: absolute`
- `top: 0`
- `right: 0`
- `bottom: 0`
- `left: 0`

Do not rely on `height: 100%` alone for the root container. In WAF player layouts that can produce a blank screen even though audio and sequence logic are running.

Do not leave rendered nodes or interactables alive after the scene exits.

## Interactables

Build learner actions explicitly with `new Interactable(...)`.

Preferred pattern:

```js
const interactable = new Interactable(element, inputEventTypes.CLICK);
interactable.onClick = handleClick;
interactable.onSelect = handleSelect;
```

Use named handlers when the behavior is more than a few lines.

Use:

- per-item interactable locking for local tap suppression
- `inputManager` locking for scene-level gating

Do not hide scene advancement inside deep callbacks that are hard to trace.

Click handlers should usually do only local interaction work:

- capture the learner's selection
- update scene-local state
- trigger immediate local feedback if needed

They should not own the overall activity completion path. Sequence middleware should decide whether the activity continues, retries, exits a loop, or finishes.

Match the event type to the prose:

- tap or click interactions should normally use `inputEventTypes.CLICK` with `onClick`
- hold or long-press interactions should use `inputEventTypes.SELECT` with `onSelect`

Do not map a prose-described tap interaction to `SELECT`.

### Hotspots: Prefer `div` Hit Areas, Not Native Buttons

When prose calls for tappable objects, letters, cards, characters, or other scene hotspots, implement the hit area as a styled `div` or equivalent non-button container and wrap it with `Interactable`.

Prefer this pattern because it keeps hotspot behavior aligned with other WAF activities:

- the visual asset remains the source of truth for what the learner sees
- HTML/CSS defines the clickable area without introducing browser button behavior
- `Interactable` controls the input model instead of native button focus or keyboard activation
- scene visuals stay easier to position, animate, dim, or highlight without button resets

Avoid native `<button>` elements for scene hotspots unless the existing module already depends on real form-style button semantics.

Preferred pattern:

1. render a `div` hotspot or wrapper element
2. place the visual asset inside it or behind it
3. set accessibility labels explicitly when needed
4. register the `div` with `new Interactable(element, inputEventTypes.CLICK | SELECT | SELECT_CLICK)` based on the prose

## Input Handoff Rules

`waitingForInput` is a timeout and activity-state signal. It is not a substitute for unlocking interaction.

If a scene locks input during intro, prompt, or feedback:

- explicitly unlock input before the learner is expected to act
- keep the unlock point visible in the middleware flow
- make every `inputManager.lock()` path have a matching unlock path unless the scene exits immediately

Typical safe pattern:

1. render interactables
2. lock input while prompt audio plays
3. finish prompt audio
4. `inputManager.unlock()`
5. enter `waitingForInput` or a wait step
6. lock again only while processing feedback

Do not assume clicks will work just because interactables were created.

Preferred interaction-loop pattern for simple learner selections:

1. arm the scene and render the interactables
2. unlock input when the learner should act
3. interactable handler captures the learner choice and calls `next()` from its closure scope
4. sequence middleware processes the choice
5. explicit exit middleware decides whether the loop is complete

If a loop uses `waitingForInput`, the next middleware in that loop must still be reachable by a guaranteed `next()` path. Do not rely on side-state changing by itself unless another middleware is actively polling for a non-interactable condition.

## Audio And Prompt Flow

Keep prompt, hint, incorrect feedback, correct feedback, and success transitions explicit in the middleware order.

If the scaffold already provides helper-based audio resolution such as `resolveAudio`, `playAudioKey`, or `setRepeatAudioForKey`, reuse those helpers instead of duplicating direct configuration lookups throughout the sequence.

When a scene changes prompt state:

1. clear or replace any repeat audio intentionally
2. play the new prompt or feedback
3. unlock input only when the learner should act next

Do not leave repeat audio active across unrelated scene transitions.

## CSS Animation Pause And Resume

The WAF player can pause a running activity (for example, when the pause overlay is shown). The framework automatically pauses audio and `legacy-animation-support` sprite animations, but it does **not** pause CSS animations or Web Animations API animations. Any motion driven by `@keyframes`, CSS transitions, or `element.animate(...)` keeps running under the pause overlay unless the module pauses it explicitly.

Whenever a generated scene starts a CSS or Web Animations API animation, wire it to the activity pause/resume events so it stops and restarts with the rest of the activity.

- keep a handle to the running animation (`element.animate(...)` returns a Web Animations `Animation` object with `.pause()` and `.play()`)
- register pause/resume handlers against the sequence data `pubSub`
- import `EVENTS` from `pubsubsingleton` (the same source `src/assessment.js` uses)
- unsubscribe both handlers in the scene cleanup boundary so they do not fire after the element is removed

`EVENTS.activity.pause` and `EVENTS.activity.resume` are the pause/resume signals. In sequence middleware the sequence data object (the `data` argument, referred to below as `sequenceData`) exposes `pubSub`.

```js
import { EVENTS } from 'pubsubsingleton';

// sequenceData is the middleware `data` argument
const animation = element.animate(keyframes, options);

const pause = () => animation.pause();
const resume = () => animation.play();

sequenceData.pubSub.subscribe(EVENTS.activity.pause, pause);
sequenceData.pubSub.subscribe(EVENTS.activity.resume, resume);

// in the scene cleanup middleware
sequenceData.pubSub.unsubscribe(EVENTS.activity.pause, pause);
sequenceData.pubSub.unsubscribe(EVENTS.activity.resume, resume);
```

For animations driven purely by a CSS class plus `@keyframes` (no `Animation` handle), toggle `element.style.animationPlayState` between `'paused'` and `'running'` inside the same pause/resume handlers instead of calling `.pause()`/`.play()`.

Do not leave a CSS or Web Animations animation running with no pause/resume wiring; it will keep animating while the activity is paused.

## Helper Extraction

Keep orchestration in `sequence.js`.

Extract helpers only when logic is:

- reused across scenes
- mostly factory code for repeated interactables
- mostly DOM math or layout computation
- mostly animation setup
- mostly repeat-audio or timing plumbing

Do not move scene control flow into helpers if it makes the sequence harder to read.

## Anti-Patterns

Do not:

- assume `waitingForInput` unlocks interaction
- leave input locked after prompt audio finishes
- keep completion logic only inside click handlers
- map prose tap or click interactions to `inputEventTypes.SELECT`
- add a wait loop after `waitingForInput` that depends on side-state but has no guaranteed `next()` handoff from the actual interaction
- use polling helpers like `waitForCondition(...)` for simple tap or click scenes when the interactable handler can capture the selection and call `next()`
- mix render, setup, feedback, and cleanup responsibilities in one large function
- invent asset or config keys that do not exist in the real module files
- recreate provided backgrounds, props, characters, animations, or videos with CSS art when matching asset keys already exist
- use gradients, borders, box shadows, pseudo-elements, or decorative text as substitutes for real scene artwork that should come from module assets
- bury scene advancement inside hidden side effects
- store `next` or similar sequence-advance callbacks on `data` just to finish the activity later from an input handler; calling `next()` directly from an interactable handler's closure is fine when the handler is the explicit handoff point for the scene
- leave interactables undisposed after the scene ends
- start a CSS or Web Animations API animation (`@keyframes`, CSS transition, or `element.animate(...)`) without wiring it to `EVENTS.activity.pause`/`EVENTS.activity.resume`, so it keeps animating while the activity is paused
- remove or hide a video element after playback completes unless the script explicitly says to clear it or a new scene replaces it

Reference example:

- For a normal learner tap, follow the click-driven style used in `waf-module-vt1adjectiveassessment`: `CLICK`/`onClick`, handler captures the selection, then sequence middleware evaluates the result.
- Use long-press `SELECT` only when the prose explicitly describes hold behavior, such as press-and-hold reward confirmation.

## Final Self-Check

Before finishing:

- verify the top-level `new Sequence([...])` reads like the activity story
- verify nested arrays represent real loops or subflows
- verify `view.elements.root` comes from the real layout id
- verify every rendered group has a cleanup boundary
- verify every interactable is either reused intentionally or disposed
- verify every CSS or Web Animations API animation is wired to `EVENTS.activity.pause`/`EVENTS.activity.resume` and unsubscribed on cleanup
- verify every `inputManager.lock()` has a visible unlock path unless the sequence exits immediately
- verify learner-ready scenes explicitly unlock input before waiting for clicks
- verify prompt, hint, feedback, and success transitions are explicit in middleware order
- verify success/completion is evaluated in explicit sequence middleware and exits the interaction loop cleanly
