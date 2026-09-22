---
name: waf-book-generation
description: Authoritative contract for independently generated Loom book modules.
---

# WAF book generation

Use this skill only when immutable product metadata declares
`activityType: "book"`. It is authoritative when its book-specific rules
conflict with generic sequence, audio, video, asset, style, or testing guidance.
Do not import, link, discover, or depend on an external shared book module or
package. Each generated product owns the scaffolded `src/book-reader/book-model.js`,
`src/book-reader/view.js`, and `src/book-reader/index.js` files shipped inside its
ordinary HTML-module scaffold. Their generated copies are extension points,
not immutable framework files. Edit the narrowest owner that matches the
requested behavior while preserving its public interface and dependency
direction. Keep `src/sequence.js` focused on language/configuration selection,
intro playback, and activity orchestration. Never copy reader
responsibilities back into `sequence.js`, and never embed ref 1's page list in
source code.

## Authoring and configuration contract

Keep `ActivitySpec` generic. Scene order is page order:

- Every book scene carries an explicit `role` field: `cover`, `title`, or
  `story`. Do not rely on an ID naming convention to recover its role.
- `cover` is optional and, when present, is first.
- `title` is optional and follows `cover`, or is first when there is no cover.
- Every remaining scene is a story page.
- Every page has exactly one primary image and an ordered list of zero or more
  audio cues. The first cue is the page's primary narration. On story pages its
  script is the visible story text and receives word timing/highlighting. Any
  remaining cues are supplemental spoken prompts: keep them hidden and play
  them in authored order after the primary narration.
- Each narration track and derived word pronunciation may select its own voice.
  Persist the adapter-native value on that audio asset; narration authored in
  Activity Script uses `audio.tracks[].voice`. Activity Description may declare
  it on an individual narration as
  `<audio voice="adapter-voice-id">spoken words</audio>`. An explicit description
  declaration wins; otherwise preserve an existing per-audio selection. When
  neither is present, use the configured default for the active TTS adapter.
  Do not model adult/child voice roles or choose voices in generated module code.
- Cover/title images contain all cover or title lettering baked into the
  artist-provided image. Do not render any HTML text, heading, narration
  script, page number, or selectable word element on cover/title pages.
  Cover/title descriptions include the baked words for meaningful image `alt`
  text.
- Story visible text is the narration script. Story images contain no story
  text. Image descriptions become meaningful `alt` text; cover/title
  descriptions include the baked words.
- Story page numbers are derived as 1 through N. Cover/title are unnumbered.
  Render the visible story number as the numeric value only, centered in the
  full-width bottom strip.

At runtime, read the language-independent `book` policy once from
`data.configuration.book`. It contains `mode`, `readingDelay`, and the optional
`introVideoKey`. Read ordered localized `scenes` from the selected language
bucket. Each scene contains `id`, `description`, `role`, `pageNumber`, and:

```json
{
  "media": {
    "image": { "key": "scene-image", "alt": "Meaningful description" },
    "audioCues": [
      { "key": "scene-narration", "script": "Visible text" },
      { "key": "scene-follow-up", "script": "A hidden follow-up prompt" }
    ],
    "narration": {
      "key": "scene-narration",
      "script": "Visible text",
      "timings": [],
      "words": [
        {
          "text": "Dash",
          "normalizedWord": "dash",
          "audioKey": "book-word-dash-...",
          "phonemes": ["d", "æ", "ʃ"],
          "phonemeTimings": [
            { "phoneme": "d", "start": 0.5, "end": 0.62 }
          ],
          "wholeWordTiming": { "start": 2.71, "end": 3.4 }
        }
      ]
    }
  }
}
```

`media.audioCues` preserves every authored `audio.tracks` entry in order.
`media.narration` is the compiled first cue, or null when the scene has no
audio. Only that first cue is page narration. Treat every later `audioCues`
entry as follow-up audio, never as part of Play/Pause narration. Derive story
paragraphs only from `media.narration.script`; never render follow-up scripts. A reader page is a presentation of a scene; do not
create or expect a separately configured `pages` collection.

Selected-language data is usable only when it contains the complete default
scene ID/order. Otherwise use the complete default-language scene collection.
Resolve media through configuration/assets using the shared asset skill.
Derive preview IDs, hydration metadata, and activity-managed audio keys from
every configured `media.audioCues` entry. Never embed authored scene IDs, scene
metadata, or media keys in generated JavaScript constants.

## Required state model

Maintain explicit runtime state for the current page, visited page IDs,
reading-delay completion, pages whose narration completed in full, full-page
narration, the active page-audio cue index, paused narration, individual word
playback, intro playback, navigation locks, page-transition cleanup, and
activity completion.
If page helpers read `reader.scenes`, initialize that reader field from
`data.scenes` before the first render; the reader must retain the resolved Book
Model rather than expecting a separate pages collection.
Cancel timers/listeners and stop owned audio on page changes and true reader
disposal. Activity completion is not reader disposal.

### Narration and follow-up audio

The page narration control owns only `media.narration`, which is the first
`media.audioCues` entry. Use separate helpers for the primary narration cue and
`media.audioCues.slice(1)` follow-up cues, while falling back to
`[media.narration]` for older configuration. Hydrate and register every primary
and follow-up cue key as activity-managed audio.

Play primary narration with its compiled timing events so story words
highlight normally. After it resolves naturally, clear its highlight and
enter a dedicated follow-up-audio state. Wait 750 milliseconds before starting
the first follow-up cue so adjacent spoken phrases have an audible pause. Play
follow-up cues automatically on `vocals`, without narration timing events,
word highlighting, or Play/Pause ownership. Keep navigation, word selection,
and the narration control disabled throughout the pause and follow-up audio.
Only after every follow-up resolves may the page be added to
`completedNarrationPageIds`, navigation unlock, or the book complete. Cancel
the pending delay and active follow-up operation on page change or reader
disposal, and guard callbacks with page identity plus an ownership token. Track
follow-up completion per page and play it only once; later Play/Pause rereads
must replay primary narration without replaying the follow-up prompt or outro.

Keep `reader.narrationOperation` pointed at the currently playing cue so Pause
and Resume operate on that exact clip. A pause must not advance the cue index.
Framework `activity.pause` and `activity.resume` events pause and resume audio
outside the reader, so their reader handlers must suspend and resume only the
timed-highlight fallback clock and must not call `clip.play()` on resume. Clear
the active highlight while framework pause is active. Subscribe separately to
`audioService.playRepeatAudio`; if Repeat interrupts active page narration,
use the reader's normal narration-pause path so the clip, fallback clock,
highlight, control state, and subsequent resume remain synchronized. Remove
all three subscriptions during reader disposal.
Stopping, changing page, failure, or cleanup must invalidate the complete cue
chain with the narration token so a late promise cannot start the following
cue. After a completed sequence, pressing Play again restarts from cue zero.
Do not mark a page complete after only its first cue.
Track the direction of each successful page change. Set
`data-book-turn="forward|backward"` on the book root before inserting the new
page so the CSS-only transition communicates navigation direction. Keep the
outgoing and incoming leaves mounted only for the transition, mark them with
`data-book-page-motion="outgoing|incoming"`, and remove the inert outgoing leaf
when the animation finishes. Give each leaf a front and paper-backed face so a
180-degree perspective rotation looks like a physical page instead of a
sliding card. Cancel and settle an in-progress transition before starting a
rapid subsequent turn. Do not delay reader state updates or interaction for
the animation, and do not use a JavaScript animation library.

Play the reusable `book-page-turn` WAF audio asset once after each successful user-initiated page change,
whether it came from a button or an allowed arrow key. Do not play it for the
initial render, a direct preview start, an invalid boundary attempt, or locked
navigation. Start it without awaiting completion, so neither navigation nor
the CSS transition waits for audio. Stop and restart the owned page-turn
operation on rapid turns, stop it during reader cleanup, and explicitly handle
playback errors without changing reader state. Play page turns on the WAF
`sfx` channel so read-along narration on `vocals` cannot interrupt them.

The top-level `waf-sequence` lifecycle must initialize once, run the reader,
and finish with `endActivity` as the final Sequence step. The reader step
renders the initial page, then awaits a completion promise. Resolve that
promise exactly once when the final-page completion condition is met, and only
then call the step's `next()`. Never call `next()` after merely rendering the
initial page: the top-level Sequence loops and would reinitialize the activity.
Do not call `endActivity` directly from a timer, audio callback, or page
interaction.

Completion is a reporting boundary, not reader teardown. Persist an
`activityComplete` flag, enter the complete state, then call
`updateControls(reader)` before resolving the completion promise so every
reading-delay and narration-completion navigation gate is cleared. The finalization step may mark
`data.activityFinished`, clear framework repeat audio, and continue to
`endActivity`, but it must not call `disposeReader`,
dispose the current page or navigation Interactables, remove the reader's
keydown listener, set `data.reader` to null, or lock the shared input manager.
Keep the live reader mounted after `endActivity` so Previous and Left Arrow
navigation remain usable and students can revisit any earlier page. Reserve
reader disposal for a true module teardown or replacement lifecycle.
When narration finishes after `activityComplete` is already true, return the
reader to its ready state and refresh controls instead of calling
`completeReader` again. Its idempotency guard has already resolved completion
and cannot restore a reader left in the narrating state.

Shared rules:

- Show exactly one active page at a time. The prior page may remain inert and
  `aria-hidden` only until its page-turn transition ends. Provide internal
  Previous, Next, and narration controls plus Left/Right Arrow navigation
  whenever the equivalent button is allowed. Do not implement swipe
  navigation.
- Create Previous, Next, and narration as accessible control elements backed by
  `Interactable` instances from `input-manager-system` using
  `inputEventTypes.CLICK`. Native `<button>` elements are optional. A custom
  control must expose `role="button"`, an accessible name, `tabindex="0"`, and
  its `aria-disabled` state. Construct each one with the positional API
  `new Interactable(controlElement, inputEventTypes.CLICK, undefined,
  undefined, moduleId)`. Never pass an options object: this package treats the
  first argument as the DOM element. Assign actions through
  `interactable.onClick`; do not attach raw click listeners or native keyboard
  handlers. Mirror every enabled-state change through the native `disabled`
  property when it exists, otherwise `aria-disabled` and a disabled class, plus
  the Interactable's `lock()` or `unlock()` method. Dispose all three
  Interactables during reader cleanup, which occurs only during true teardown
  and never during activity completion. Passing the module ID as the fifth
  argument keeps WAF testing and waiting-for-input ownership correct. Unlock
  the shared `inputManager` after the initial page setup and lock it again
  during reader cleanup; per-control locking does not replace that global
  lifecycle.
- Hide Previous on the first page and Next on the final page; neither control
  may remain visible merely in a disabled state at its boundary. Never add a
  synthetic ending page. Keep the final page and the live reader visible after
  calling the normal activity completion operation. On the completed final
  page, Previous must remain enabled when an earlier page exists, and both its
  Interactable and Left Arrow path must continue to navigate backward.
- After activity completion, reading requirements no longer constrain page
  navigation. Do not schedule a decodable reading delay, hide controls behind
  an active delay, or require narration completion on any subsequent page
  visit—even if that page is being visited for the first time. Previous, Next,
  Left Arrow, and Right Arrow are then governed only by page boundaries and
  ordinary in-progress audio/page-turn locks, so the student can immediately
  navigate throughout the book.
- The complete ordered page-audio sequence and word pronunciation never
  overlap. While any page cue plays, page turns and word selection are locked.
  Keep the narration control visible and enabled while narration plays,
  including every supplemental cue in the sequence,
  so it can pause the active clip; switch from the inactive to the supplied
  active play/pause artwork (never simulate this with a CSS filter) and expose
  an accurate accessible name.
  Pausing narration unlocks page turns and word selection. Playing a word while
  narration is paused leaves narration paused.
  Preserve that distinction in the reader state machine: before entering the
  individual-word state, record whether a real narration operation is paused.
  After word playback settles, restore `paused` only when that same narration
  operation still exists; otherwise restore `ready`. Never synthesize a paused
  narration state after word playback when full-page narration has not started.
  Play individual word pronunciation on the independent `sfx` channel so it
  cannot complete or replace a paused page-narration operation on `vocals`.
  Page-turn audio cannot overlap it because navigation remains locked during
  word playback.
  Likewise, the narration control may take its resume path only when both the
  reader state is `paused` and the stored narration operation is non-null;
  recover any stale paused-without-an-operation state by starting narration as
  a fresh operation.
  Pause and resume through helpers that suspend and resume the timed-audio
  fallback with the WAF `PlayOperation`. The fallback must cancel pending
  timers on pause, retain elapsed playback time, and schedule only unfired
  cues relative to that elapsed time on resume. The operation exposes
  `pause()`, `play()`, and `stop()`, but does not expose `resume()`.
- Revisiting a page is quiet: do not replay narration or rerun its reading
  delay. Restore its already-unlocked state.
- Render every story word as an inline non-button element, such as a `span`,
  with `data-book-word` and `data-book-word-key`. Give each word its own
  `input-manager-system` `Interactable`, constructed with the same positional
  API as navigation:
  `new Interactable(wordElement, inputEventTypes.CLICK, undefined, undefined,
  moduleId)`. Set its action through `interactable.onClick`; do not attach raw
  click listeners or native keyboard handlers. Store the word Interactables
  with the current page, use `lock()`/`unlock()` to control availability, and
  dispose them on page change and reader cleanup. `Interactable` controls
  activation, matching standard activity hotspots. Use the compiled
  occurrence-to-audio mapping.
- Render story scripts as paragraph elements, with words inline inside each
  paragraph. The centered story-text grid must contain paragraph blocks rather
  than individual word elements; placing every word directly in the grid turns
  a sentence into a vertical list. When attaching a word handler, capture that
  occurrence's index in an immutable `const` before incrementing the rendering
  counter, so a click highlights the clicked word rather than the final word.
- Highlight the active story word from the compiled narration timings and
  clear highlights on pause, completion, stop, page change, or error.
  Create the narration operation with `createTimedAudioOperation` and start it
  through the scaffolded `playTimedAudioOperation` (or an equivalent helper
  that attaches its timed-event fallback). Calling the raw operation's `play()`
  bypasses word cues for URL-backed audio and is not acceptable.
  Ignore queued audio-time events unless the same page is still narrating, so
  a late cue cannot restore a highlight after pause or cleanup.
- While an individual word pronunciation plays, use the same highlight color
  as full-page narration. The audio's first phase is a natural, drawn-out
  reading of the whole word, followed after a pause by its fluent
  reading. Blend the sounds into the word as in a slow read; do not speak
  phoneme names. During the slow phase, build a cumulative left-to-right fill
  inside the clicked word. When a grapheme cue begins, apply that color to its
  span without clearing any earlier span; do not also highlight the whole word.
  Keep every otherwise eligible
  Previous, Next, and narration control visible in its stable position, but
  disable all three until the word finishes. Do not hide or shift them during
  word audio. Boundary controls remain hidden normally. Clear the highlight when
  that pronunciation completes, stops, or fails.
- In decodable mode, use the compiled `phonemes` and `phonemeTimings` only to
  schedule spelling highlights; never display IPA phoneme symbols to the
  student. Split the clicked word's visible spelling into grapheme spans that
  correspond to its sounds (for example, render `Dash` as `D` + `a` + `sh`),
  while preserving the word's exact text, capitalization, spacing, and inline
  position. Highlight those grapheme spans inside the original clicked word.
  Do not render a second copy or breakdown of the word below the narration
  text; the word already present in the page text is the only student-facing
  copy.
  `phonemeTimings` cue times are seconds from the beginning of the individual
  word audio. They mark visual grapheme boundaries within the drawn-out
  whole-word reading; they do not define spoken phoneme names. During that
  opening slow reading, add the grapheme span represented by each active cue to
  the filled set, without a simultaneous background highlight on the whole
  word. Once a grapheme is filled, keep it filled through all later cues and
  cue gaps in the slow phase. Do not clear individual graphemes at their cue end.
  Clear the complete accumulated fill when the slow phase ends so
  no highlight remains during the pause.
  For the fluent pronunciation described by `wholeWordTiming`, highlight only the whole word.
  Clear every highlight when playback completes, stops, fails, or the page
  changes. If timings are absent, the word audio may still play, but do not
  fabricate timing cues or spelling-to-sound boundaries.
- Buttons have accessible names and visible focus. Images use compiled alt
  text. Announce material page/state changes without stealing focus.

### Decodable mode

- Cover/title audio cues autoplay in order when present and lock navigation
  until the complete sequence finishes. Without audio cues they unlock
  immediately.
- Story narration never autoplays.
- On a story page's first visit, hide Previous, Next, and narration, then wait
  `secondsPerWord * visibleWordCount` clamped to the configured minimum and
  maximum (defaults 0.5, 3, and 10 seconds). After the delay, reveal the
  Play/Pause narration control when narration is available, and reveal Previous
  when a preceding page exists. Keep Next hidden until the student starts that
  narration from Play/Pause and the complete ordered cue sequence finishes in
  full at least once; then reveal Next when a following page is available. A
  narration-less nonfinal story page reveals available navigation after its
  reading delay because it has no Play/Pause interaction to complete.
  Left Arrow follows Previous availability and Right Arrow follows Next
  availability, so a hidden control cannot be bypassed. These first-visit
  reading requirements apply only before the activity completes.
- Narration starts only from its control. The final page completes when its
  complete ordered audio-cue sequence has completed in full at least once. Reaching the
  page, waiting out its reading delay, finishing only the primary narration, or
  pausing partway through must not complete the activity. Mark completion only
  after the final cue's successful completion path. A decodable book therefore
  requires primary narration on its final story page.

Before completing a book implementation, verify the rendered reader itself:

- Story text and the page number are black (`#000`) in WaterfordNo3 on the white
  reading surface; do not inherit an arbitrary host color.
- On the first visit to every decodable story page, Previous, Next, and the
  Play/Pause narration control are all hidden until the reading delay resolves.
  Once it resolves, reveal Play/Pause when narration is available and reveal
  Previous when a preceding page exists. Keep Next hidden until the student has
  completed that page's manually started ordered narration once. Never show
  Previous on the first page or Next on the final page. The Left and Right
  Arrow paths must use the same availability as their matching controls, so
  hidden controls cannot be bypassed.
- Fade every book control in and out over 240ms using opacity only. Do not
  toggle `display`, use the `hidden` attribute, or remove a control from the
  DOM to change its visibility: those approaches prevent the fade-out and make
  a newly visible control jump into place. Apply `aria-hidden`, `tabindex`, and
  `pointer-events` immediately while the visual fade completes. The existing
  reduced-motion rule must reduce this transition to an effectively immediate
  change.
- A turn retains the outgoing and incoming leaves with front and paper-backed
  faces. The forward/backward CSS applies the reference 3D rotation plus its edge
  light and shadow; a flat slide or opacity-only swap is not an acceptable turn.
- Place Previous, Next, and narration flush with their fixed interaction-frame
  edges: use a literal `0px` for the relevant horizontal inset. The narration
  state must swap the supplied active/inactive
  artwork rather than applying a brightness filter.

### Read-along mode

- On every page's first visit, autoplay its complete audio-cue sequence when
  present.
- Lock Next until that complete sequence finishes. Never auto-advance.
- A first-visit page without narration unlocks immediately.
- Revisits remain quiet and unlocked.
- The final page completes when its first automatic audio-cue sequence
  finishes, or immediately when it has no audio cues.

## Reference scaffold patterns

The book scaffold contains a complete runnable reader split across three
generated files. The generated copies are extension points: agents may extend
them when the activity contract requires behavior beyond the defaults. Edit the
narrowest owner:

- `src/book-reader/book-model.js` owns the configured Book Model, normalized content,
  word/grapheme timing compilation, and activity-managed audio-key discovery.
- `src/book-reader/view.js` owns reader DOM, controls, accessibility state,
  word elements, highlights, and page-turn presentation.
- `src/book-reader/index.js` owns audio coordination, navigation policy, reader modes,
  completion, and lifecycle. Its stable facade remains
  `initializeBookReader(data)` plus the `runBookReader` sequence middleware.
- `src/sequence.js` owns language/configuration selection, intro playback,
  and top-level activity orchestration—not reader internals.

Preserve one-way dependencies: the Book Model must not import view or the Book
Reader interface, view must not import the Book Reader interface, and the Book
Reader interface may compose both. Preserve the scaffolded
exports, and do not delete, merge, or collapse these files merely to customize
one product. Never duplicate reader behavior in `src/sequence.js` or create
per-scene reader functions.
Retain the explicit control ownership pattern:

```js
function setControlEnabled(control, enabled) {
    if ('disabled' in control.element) {
        control.element.disabled = !enabled;
    } else {
        control.element.setAttribute('aria-disabled', String(!enabled));
        control.element.classList.toggle('is-disabled', !enabled);
    }

    if (enabled) {
        control.interactable.unlock();
    } else {
        control.interactable.lock();
    }
}

const interactable = new Interactable(
    button,
    inputEventTypes.CLICK,
    undefined,
    undefined,
    reader.moduleId
);
interactable.onClick = handler;
```

Keep the reader alive as one Sequence step. Rendering a page must not advance
the top-level sequence; only the final-page completion promise may do so:

```js
const initialIndex = resolveInitialReaderIndex(data, reader.scenes);

reader.completion = {};
reader.completion.promise = new Promise((resolve) => {
    reader.completion.resolve = resolve;
});
view.render('root', { readerRoot: reader.root });
await renderPage(data, reader, initialIndex, '');
inputManager.unlock();
await reader.completion.promise;
next();
```

The completion path must refresh controls before it resolves, while the
top-level finalization path reports completion without disposing the reader:

```js
function completeReader(reader) {
    if (!reader || reader.completion.resolved) {
        return;
    }

    reader.activityComplete = true;
    enterReaderState(reader, 'complete');
    reader.completion.resolve();
}

function finalizeActivity({ data, next }) {
    clearRepeatAudio();
    data.activityFinished = true;
    enterActivityState(data, 'activity.complete', {
        interactive: false,
    });
    next();
}
```

`enterReaderState` must update controls before publishing the state and derive
`interactive` from actual enabled controls plus the global input-manager lock.

Page rendering must clean up the old page, retain it only for the page-turn
animation, and drive first-visit behavior from the configured mode:

```js
await hydrateStageAssets(data, sceneAssetMetadata(scene), managedAudioKeys(reader.scenes));
cancelReadingDelay(reader);
stopOwnedAudio(reader);
disposeCurrentPage(reader);
const outgoing = reader.currentLeaf;
reader.currentIndex = index;
animatePageTurn(reader, outgoing, createPageLeaf(data, reader, scene), direction);

if (scene.role === 'story' && reader.policy.mode === 'decodable') {
    scheduleReadingDelay(reader, scene);
} else if (reader.policy.mode === 'readAlong' && sceneAudioCues(scene).length) {
    startNarration(data, reader);
}
```

Do not paste authored scene IDs, media keys, or product-specific DOM IDs into
these helpers. The scaffold derives them from `data.scenes` and the resolved
Book Model.

Create the reader controls with the scaffold's owned `Interactable` pattern,
then mirror their availability through the element's disabled state and WAF:

```js
function setControlVisible(control, visible) {
    const { element } = control;

    element.classList.toggle('is-book-control-visible', visible);
    element.setAttribute('aria-hidden', String(!visible));
    element.tabIndex = visible ? 0 : -1;
}

function makeControl(reader, controlName, accessibleName, handler) {
    const controlElement = htmlToElement('<div role="button" tabindex="0"></div>');

    controlElement.dataset.bookControl = controlName;
    controlElement.setAttribute('aria-label', accessibleName);
    const interactable = new Interactable(
        controlElement,
        inputEventTypes.CLICK,
        undefined,
        undefined,
        reader.moduleId
    );

    interactable.onClick = handler;
    return { element: controlElement, interactable };
}

function updateControls(reader) {
    const scene = reader.scenes[reader.currentIndex];

    if (!scene) {
        Object.values(reader.controls).forEach((control) => {
            setControlVisible(control, false);
            setControlEnabled(control, false);
        });
        return;
    }

    const delayHidden = reader.readingDelayActive && scene.role === 'story';
    const firstPage = reader.currentIndex === 0;
    const lastPage = reader.currentIndex === reader.scenes.length - 1;
    const hasNarration = sceneAudioCues(scene).length > 0;
    const decodableStory =
        reader.policy.mode === 'decodable' && scene.role === 'story';
    const narrationCompleted = reader.completedNarrationPageIds.has(scene.id);
    const nextNavigationUnlocked =
        !decodableStory || !hasNarration || narrationCompleted;
    const playingAudio = reader.state === 'narrating' || reader.state === 'word-audio';
    const canNavigate =
        !delayHidden &&
        !reader.isNavigating &&
        !playingAudio;
    const canControlNarration =
        !delayHidden &&
        hasNarration &&
        !reader.isNavigating &&
        reader.state !== 'word-audio';
    const previousVisible = !delayHidden && !firstPage;
    const nextVisible = !delayHidden && !lastPage && nextNavigationUnlocked;
    const narrationVisible = !delayHidden && hasNarration;

    setControlVisible(reader.controls.previous, previousVisible);
    setControlVisible(reader.controls.next, nextVisible);
    setControlVisible(reader.controls.narration, narrationVisible);
    setControlEnabled(reader.controls.previous, canNavigate && previousVisible);
    setControlEnabled(reader.controls.next, canNavigate && nextVisible);
    setControlEnabled(reader.controls.narration, canControlNarration);
}
```

Keep all reader controls hidden and disabled until `reader.currentIndex`
identifies a valid scene. Reader construction may create the controls before
the first page is rendered, so `updateControls` must treat that pre-render
state as normal and must not read fields from a missing scene.

Mark a decodable page as navigable only from the successful natural-completion
path after the final cue of its manually started sequence. Do not call
`onNarrationCompleted` for an intermediate cue, or unlock navigation when
playback is paused, stopped, fails, or is superseded during cleanup:

```js
function onNarrationCompleted(data, reader, scene) {
  reader.completedNarrationPageIds.add(scene.id);

  if (reader.activityComplete) {
    enterReaderState(reader, 'ready');
    return;
  }

    if (
        reader.policy.mode === 'decodable' &&
        scene.role === 'story'
    ) {
        updateControls(reader);

        if (reader.currentIndex === reader.scenes.length - 1) {
            completeReader(reader);
      return;
        }
    }

  enterReaderState(reader, 'ready');
}
```

Use this fade treatment in the generated book stylesheet; it preserves each
control's fixed position while it appears or disappears:

```scss
[data-book-control] {
  opacity: 0;
  pointer-events: none;
  visibility: hidden;
  transition:
    opacity 240ms cubic-bezier(0.25, 1, 0.5, 1),
    visibility 0s linear 240ms;
}

[data-book-control].is-book-control-visible {
  opacity: 1;
  pointer-events: auto;
  visibility: visible;
  transition-delay: 0s;
}
```

Create pages from configured data and dispose their word interactables whenever
the page changes. Call `appendStoryText` only for story scenes; cover and title
scenes must use their full-page artwork without narration text or word
interactables. Capture each story-word occurrence before it is incremented:

```js
const occurrence = occurrenceIndex;
const word = wordMetadata[occurrence];
const wordElement = htmlToElement('<span></span>');

wordElement.dataset.bookWord = '';
wordElement.dataset.bookWordKey = word.normalizedWord || token.toLowerCase();
wordElement.textContent = token;
const interactable = new Interactable(
    wordElement,
    inputEventTypes.CLICK,
    undefined,
    undefined,
    reader.moduleId
);

interactable.onClick = () => playWord(data, reader, occurrence);
reader.wordElements.push(wordElement);
reader.wordInteractables.push(interactable);
occurrenceIndex += 1;
```

Use the configured reading mode to control first visits. Read-along never
auto-advances, while a final page without narration completes immediately:

```js
if (scene.role === 'story' && reader.policy.mode === 'decodable') {
    scheduleReadingDelay(reader, scene);
    return;
}

if ((scene.role === 'cover' || scene.role === 'title') &&
    sceneAudioCues(scene).length && firstVisit) {
    startNarration(data, reader);
    return;
}

if (reader.policy.mode === 'readAlong' && firstVisit) {
    if (sceneAudioCues(scene).length) {
        startNarration(data, reader);
    } else if (reader.currentIndex === reader.scenes.length - 1) {
        completeReader(reader);
    }
}
```

## Optional intro video

The ref-level key is exactly `book-intro-video`; it is not a scene. For a full
Beginning preview, play it before the cover when configured. A named-scene
preview skips it. With no attached video, start the selected page immediately.
Preserve the scaffolded intro path when changing reader behavior.

During intro playback, keep all book controls unavailable. Use the supported
WAF video operation, wait for readiness, arm the native `playing`/error waits
before starting playback, and await completion before starting cover
narration. The embedded video audio is the only intro audio. It cannot be
skipped and must follow the player pause/resume lifecycle. Log load/playback
failure, clean up the operation, and continue to the cover.

Every book implementation must support this path even when no intro video is
currently attached: read `policy.introVideoKey` and `policy.introVideoUrl`,
skip it for a named-scene preview, mount the operation's video element with
`data-book-intro-video`, then await `waitForVideoReady`,
`waitForVideoPlaying`, and `operation.playAsync()` before rendering the cover.
Do not treat the absence of an intro when behavior is generated as permission
to omit this runtime path; users can attach the optional video later. Keep the
reader hidden and do not render its controls until the optional video
completes.

Do not render a start button or `data-book-intro-start` hook for an optional
intro. Start the WAF operation after readiness, with the playing wait armed
before playback, and log failure before continuing to the cover:

```js
await waitForVideoReady(operation.videoElement);
const playing = waitForVideoPlaying(operation.videoElement);

await Promise.all([playing, operation.playAsync()]);
```

## Preview start

Read Loom's supported preview-start configuration through the scaffolded
`src/preview-start.js` helper. Beginning includes the intro. A direct scene
start selects that page and skips the intro, but it must retain the complete
ordered scene list in `reader.scenes`. Resolve the selected page to an
`initialIndex` and render that index first; do not implement preview selection
by slicing `data.scenes` or `reader.scenes`. A named-scene preview must not
slice away preceding pages because Previous and Left Arrow must reach them,
including after final-page completion:

```js
function resolveInitialReaderIndex(data, scenes) {
    if (!data.previewStartSceneId) {
        return 0;
    }

    const previewIndex = scenes.findIndex(
        (scene) => scene.id === data.previewStartSceneId
    );

    return previewIndex === -1 ? 0 : previewIndex;
}

reader.scenes = data.scenes.slice();
const initialIndex = resolveInitialReaderIndex(data, reader.scenes);
await renderPage(data, reader, initialIndex, '');
```

## Stable semantic hooks

DOM structure and class names remain product-specific, but expose these stable
hooks:

- `data-book-root` on the book root
- `data-book-page="<page-id>"` and
  `data-book-page-role="cover|title|story"` on the visible page
- `data-book-control="previous|next|narration"` on controls
- `data-book-word` and `data-book-word-key="<normalized-word>"` on story words
- `data-book-intro-video` on the intro video element
- `data-book-turn="forward|backward"` during page changes
- `data-book-state` on the root, with clear values for intro, delay, narrating,
  paused, word-audio, ready, and complete

Generated tests use these hooks, accessible roles/names, and observable WAF
completion rather than product-specific CSS classes or timing guesses.

## Layout

Start from the book-specific scaffold styles in `res/style.scss`. Adapt class
names to the independently generated product. Preserve a centered 4:3 white
page inside a full-container `#EFEEE8` PubCoder letterbox surface, separate
page/image/text/control regions, overflow protection, highlighted-word state,
focus visibility, and reduced-motion behavior. On wider displays, the control
layer is a centered, fixed-position interaction frame matching the white 4:3
book page: it must use `width: min(100cqw, 133.333cqh)` and
`transform: translateX(-50%)`, so the outer edges of Previous, Next, and
narration sit on the white page bounds on 3:2 and 16:9 displays rather than
overlapping the `#EFEEE8` letterbox rails. At the compact 4:3 cutoff, expand
the interaction frame to the full reader width so the controls sit flush with
the stage edges despite the vertical space reserved for Loom's navbar.
Keep controls at least 44 by 44 CSS pixels
on compact displays. Do not add branding or inline styles. Story illustrations
use one enlarged fixed frame: 608 by 396 units at x=96 and y=24 on the 800 by
600 page. Fit the complete artwork inside that frame with `object-fit: contain`
so source aspect ratios cannot crop or stretch authored content while the
rendered page geometry remains fixed. Reserve a centered 129-unit text region
below it so four authored lines remain visible. Cover/title artwork remains
full-page.

The reusable reader artwork is exposed through the module's root and
selected-theme `definition.json` assets. Resolve `book-next-page` for both page
controls, rotating Previous 180 degrees. Resolve `book-narration-inactive` for
idle/paused narration and `book-narration-active` while narration is playing.
Render all three controls at 84 by 84 units in the 800 by 600 canvas, keeping
their accessible button names and visible focus treatment. Resolve and play the
WAF-managed `book-page-turn` audio asset for the generic page-turn sound. Never
put literal `book-reader/...` URLs in generated JavaScript or CSS; those paths
resolve against the host player instead of the module and return broken artwork.
All controls use `clamp(44px, 14cqh, 84px)` for width and height; Previous and Next sit at `top: 50%` with a literal `0px` outer inset; narration sits at `top: 17cqh` with the same literal right inset. Keep the 21.5%-high story-text region
as a grid with `place-content: center` so one short sentence and four authored
lines are both vertically centered within the reserved region. Loom reserves
vertical space for its navbar, making the nominal 640 by 480 (4:3) preview
stage approximately 640 by 441. Therefore use a `max-aspect-ratio: 3 / 2`
container-query cutoff for the compact white-canvas treatment and override the
interaction frame with `left: 0`, `width: 100%`, and `transform: none`. The
interaction frame uses the same literal `0px` control insets at every aspect
ratio: at compact 4:3 sizes Previous is flush with the reader's left edge,
while Next and narration are flush with its right edge.

Use white for the page and
`#EFEEE8` for the full-reader letterbox area visible beside the centered page on
wider-than-Loom's-4:3-stage aspect ratios. At and below the `3 / 2` compact
cutoff, make the reader surface white so no letterbox color is visible. Do not
stretch or recolor the page to hide the wide-screen field. Use WaterfordNo3 at 22 CSS
pixels on the 800 by 600 reference page for story text, with weight 400 and a
1.35 line height. Use WaterfordNo3 at 16 CSS pixels for the centered page
number, and black text. Keep the page number centered but lift it 10 units from
the bottom edge so host navigation cannot clip it. Preserve the script's normal
authored whitespace between inline word elements: place it in a text node or at
the end of the preceding word element, and use normal word and letter spacing.
Do not use a custom `word-spacing` value, per-word layout margins, or a flex/grid
word layout to compensate for missing spaces. The active-word highlight is the
PubCoder media-overlay yellow, `rgba(255, 216, 17, 0.6078431)`, with compact
2px horizontal padding, -2px inline compensation, and a 3px corner radius on
the 800 by 600 reference page. These values scale with the reference page and
must not inherit the host player's font size. The book generation extension sets
the module's `definition.json` font requirement to
`{{MEDIA}}/fonts/WaterfordNo3/WaterfordNo3.css`; do not remove or replace it.

Use the reference CSS page-turn structure and keyframes when changing pages.
Keep the reference selector and keyframe names verbatim in generated styles:
`[data-book-control="previous"]`, `[data-book-control="next"]`,
`[data-book-control="narration"]`, `book-page-turn-forward`,
`book-page-turn-backward`, and `book-page-edge-light`. Do not replace them
with shortened aliases; the reference names are part of the reader contract.
Capture the outgoing leaf before mounting the incoming leaf. Do not assign the
incoming leaf to `reader.currentLeaf` until after the page-turn renderer has
read the previous value; otherwise transition cleanup removes the new page.
The outgoing leaf folds from 0 to -180 degrees around the left-side spine on a
forward turn; the incoming prior leaf unfolds from -180 to 0 degrees on a
backward turn. Layer a restrained moving edge light and cast shadow over the
front face and a warm paper gradient over the back face. Animate only
`transform` and `opacity`, keep the transition at or under 500 ms, and do not
add a JavaScript animation dependency. The reduced-motion media query must
collapse the transition to an effectively immediate state change.

## Playwright coverage

Generate deterministic coverage for both the declared mode and relevant
optional branches:

In read-along mode, narration intentionally disables Previous and Next. Before
clicking either page control, wait for the current scene's interactive `.ready`
state. When navigation follows automatic narration, first observe the
narration media `completed` or `unavailable` lifecycle after the captured
cursor, then wait for `<scene-id>.ready`. A disabled page control during
`.narrating` is expected; never force the click.

Read-along narration autoplays only on the first visit to a story scene. A
backward/forward revisit is deliberately quiet and enters the interactive
`<scene-id>.ready` state directly; tests for cursor freshness must wait for that
new `.ready` record and must not expect another `.narrating` transition.

- Beginning plays an attached intro before the cover; named-scene preview skips
  it; video failure falls through.
- Cover/title ordering and narration gating, including no HTML text over
  artist-provided cover/title artwork.
- Decodable reading-delay bounds and manual narration.
- Decodable control visibility after the reading delay, including no Previous
  on the first page, no Next on the final page, and no Next before the
  page's manual narration completes once.
- Decodable controls fading in after the delay: Play/Pause appears first;
  Previous appears at the same time when a preceding page exists, while Next
  appears only after manual narration completes once.
- Read-along first-visit autoplay without auto-advance.
- Timing-driven highlighting and individual word playback without overlap,
  with eligible page controls visible but disabled until word audio finishes;
  verify that a clicked individual word receives the yellow active highlight
  and that each corresponding grapheme span joins a cumulative left-to-right
  fill at its compiled cue time, remains filled through the rest of the slow
  phase, and clears before the fluent pronunciation. Assert that the rendered
  student-facing text contains only the word's spelling and never the IPA
  phoneme symbols.
- Button and keyboard navigation lock/unlock plus quiet revisits.
- Previous, Next, and narration registered as module-owned
  `input-manager-system` Interactables, including managed locking and cleanup.
- Forward/backward page-turn direction, including the reduced-motion fallback.
- Page-turn audio once per successful button/keyboard turn, with no sound for
  initial, locked, or out-of-bounds navigation.
- Stable 4:3 page geometry, unclipped page numbers, stage-edge control
  coordinates at compact 4:3 sizes, and page-edge control coordinates at
  representative 3:2 and 16:9 container sizes.
- Decodable completion only after the final narration completes once, including
  pause/resume and interrupted-playback cases, with no extra page. After the
  completion event, assert that Previous remains enabled, clicking it returns
  to the preceding page, Left Arrow can continue navigating backward, and all
  bounded button/Arrow navigation across the book is immediate without a new
  reading delay or narration-completion gate.
- Read-along final-page completion with missing optional narration.
- Enter/Space word activation, visible focus, meaningful image alt, and the
  normal accessibility scan.

Use fake/controlled clocks and instrumented playback events where the runner
supports them. Do not rely on arbitrary sleeps.
