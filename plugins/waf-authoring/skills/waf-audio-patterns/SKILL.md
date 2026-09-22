---
name: waf-audio-patterns
description: Use when implementing audio in pipeline-generated WAF HTML sequence modules. Follow the established config shape, asset sourcing, playback, timing, repeat-audio, and input-locking patterns used by the working reference modules.
---

# WAF Audio Patterns

## Contract requirements

For every `interruptible: true` track, use the scoped
`runInterruptedChains` pattern: register `clip.stop()` through `onAbort`, arm
the accepted interaction before playback, and call the returned scoped
`interrupt` function from every accepted tap or selection path. Do not use a
global cancellation helper for a single cue.

Only configure Repeat while the matching learner interaction is active. Set
the interaction-lifetime flag false before accepting a choice, clearing
Repeat, or resolving the answer; a delayed preview-audio `finally` block must
not restore Repeat after the interaction ends. Do not configure narration,
transitions, celebrations, review-only playback, or closing audio as Repeat.

Use this skill when authoring or editing audio behavior in `src/sequence.js` or audio-focused helpers for pipeline-generated WAF HTML modules.

The goal is to make audio implementation match the real WAF runtime and the established patterns already used by working modules in this repo.

## Core Runtime Rule

In WAF sequence modules, treat `data.configuration` as the module-local configuration object.

Do not re-index configuration by module id.

Correct:

```js
const moduleConfig = data.configuration;
await playAudio(moduleConfig.intro_today_date);
```

Incorrect:

```js
const moduleConfig = data.configuration['calendar-test'];
const moduleConfig = data.configuration[MODULE_ID];
```

That incorrect pattern can produce `undefined` and break intro or feedback audio at runtime.

## Hydrated Vs Raw Configuration

Before implementing config-backed audio, determine whether the module is using the default `bootstrapSequence(...)` behavior or explicitly opts out with `hydrateConfig: false`.

### Default case: hydrated configuration

If the module uses plain:

```js
bootstrapSequence(sequence);
```

then configuration-backed audio entries may already be hydrated into playable WAF audio objects.

In that case:

- expect entries to support methods like `play()` or `playAsync()`
- prefer resolving clips through a small helper such as `resolveAudio(data, key)` or `playAudioKey(data, key)` instead of scattering direct `data.configuration.someKey.playAsync()` calls throughout the sequence
- use hydrated config entries directly inside that helper when they are already playable
- do not rebuild every config audio entry through `getPlayOperation(...)`

Typical pattern:

```js
async function playAudioKey(data, key) {
    const clip = resolveAudio(data, key);
    if (!clip) return;
    await clip.playAsync();
}

await playAudioKey(data, 'intro_narration');
```

### Opt-out case: raw configuration

If the module explicitly uses:

```js
bootstrapSequence(sequence, {
    hydrateConfig: false,
});
```

then config-backed audio may still be raw values such as URLs or `customClipUrl` objects.

In that case:

- inspect the real config entry shape first
- use raw entries directly only when the working module pattern does so
- use `getPlayOperation(...)` only where a real raw URL-based play operation must be constructed

Typical pattern:

```js
const audio = getPlayOperation({
    audioPaths: configuration.someAudio.customClipUrl,
    channel: 'music',
});
```

Do not assume raw config unless `hydrateConfig: false` or real module evidence confirms it.

## Source Of Truth For Audio

Use the real module inputs before writing audio code:

1. Read `definition.json` and identify audio exposed through theme assets.
2. Read `configurations/<productCode>-<refNum>.json` and identify audio keys provided by module configuration.
3. Read `generated/<productCode>/refs/<refNum>/spec/asset_manifest.json` and, for every
   audio clip you might drive with mid-clip choreography (syllable highlights, per-word
   reveals, tracking visuals synced to narration), check whether its asset entry carries
   `wordTimings` / `durationMs`. This is the **only** place measured cue times are exposed.
4. Read the actual sequence/layout/style files to match the local module conventions.

Never invent audio keys. Use only keys that exist in real config or assets.

## Audio Sourcing Rules

Use `data.assets[...]` for:

- audio defined in `definition.json`
- theme-backed clips already loaded as module assets
- cases where existing modules already play clips directly from `assets`
- most hand-authored module patterns already established in `modules/`

Use `data.configuration[...]` for:

- audio configured in `configurations/<productCode>-<refNum>.json`
- module-local prompt, hint, and feedback clips
- cases where the generated module expects configuration-driven audio

If the configuration entry is already a playable WAF audio object, use it directly.

If the configuration entry is a raw URL-like shape such as `customClipUrl`, build a play operation with `getPlayOperation(...)` and cache it on `data`. Use the resolved media URL plus playback options such as channel, loop, and volume as the cache identity—not the logical asset key—so aliases of one clip reuse the same operation.

When an activity must construct an audio operation itself to apply custom channel,
loop, volume, or timed-event behavior, add that key to the scaffolded
`ACTIVITY_MANAGED_AUDIO_KEYS` set. Generic stage hydration must skip those keys;
otherwise it creates a default playable immediately before the activity creates the
real customized operation for the same URL.

Do not convert hydrated playable config audio into a second custom wrapper unless there is a specific need the real module pattern already uses.

## Localized Audio Rule

Default-language audio is the source for one-shot playback such as prompts, narration, hints, and feedback.

If an audio key has a non-default-language clip in configuration, apply that localized clip only through repeat audio setup:

- use `setRepeatAudioForKey(data, key)` when the generated scaffold provides it
- otherwise use `setRepeatAudio(...)` directly with the localized source
- do not play the non-default-language clip with `playAudioKey`, `playAsync`, or `createAudioEvents`

The presence of a localized clip does **not** mean the clip should automatically become
repeat audio. Configure repeat audio only when the learner is entering or remaining in an
interaction where that exact prompt, hint, or feedback can be requested again. Narration,
review-only pauses, transitions, celebrations, and closing audio are one-shot clips and must
not call `setRepeatAudioForKey(...)` or `setRepeatAudio(...)`.

This keeps the first explicit instruction in the default language while allowing the repeat instruction to use the learner's selected language.

## Recommended Generated-Module Pattern

For pipeline-generated modules, prefer a small helper-based pattern over repeated direct property access.

Use:

- `resolveAudio(data, key)` to locate a clip from configuration first, then assets when appropriate
- `playAudioKey(data, key)` to play one-shot prompt, hint, and feedback clips
- a small cache on `data` only when raw URL-backed clips must be wrapped with `getPlayOperation(...)`

Prefer this over repeating code like:

```js
await data.configuration.somePrompt.playAsync();
await data.configuration.someHint.playAsync();
await data.configuration.someFeedback.playAsync();
```

That direct style is brittle in generated modules because:

- it spreads config-shape assumptions across many call sites
- it makes missing keys fail deeper in scene logic instead of in one resolver
- it makes it harder to fall back between `configuration` and `assets`
- it makes raw-vs-hydrated config handling harder to keep consistent

Preferred pattern:

```js
function resolveAudio(data, key) {
    const source =
        data.configuration[key] != null ? data.configuration[key] : data.assets[key];

    if (!source) return null;

    if (typeof source.playAsync === 'function' || typeof source.play === 'function') {
        return source;
    }

    if (typeof source === 'string') {
        return getPlayOperation({
            audioPaths: source,
            channel: 'sfx',
        });
    }

    if (typeof source.customClipUrl === 'string') {
        return getPlayOperation({
            audioPaths: source.customClipUrl,
            channel: 'sfx',
        });
    }

    return null;
}

async function playAudioKey(data, key) {
    const clip = resolveAudio(data, key);
    if (!clip) return;

    if (typeof clip.playAsync === 'function') {
        await clip.playAsync();
        return;
    }

    const events = createAudioEvents(clip);
    clip.play();
    await events.completed;
}
```

Use literal keys that already exist in `definition.json` or `configurations/<productCode>-<refNum>.json`. Do not invent alternate audio names in code.

## Preferred Playback Patterns

### One-shot sequential audio

Use `await clip.playAsync()` when only completion matters:

- intro narration
- prompt audio
- correct feedback
- incorrect feedback
- hint feedback
- outro narration

This is the default pattern for simple scene flow.

### Audio synchronized with animation or timed scene changes

Use `createAudioEvents(clip)` with `clip.play()` when the code needs:

- `started`
- `completed`
- choreography that lines up with audio timing

Typical pattern:

```js
const events = createAudioEvents(clip);
clip.play();
await events.started;
// start visual work
await events.completed;
```

Use this only when the scene actually depends on audio event timing.

### Dynamic URL-backed audio

Use `getPlayOperation(...)` when a clip must be constructed from a URL or `customClipUrl`, especially for:

- background music loops
- custom audio clips from config
- dynamically selected tracks

Cache the resulting play operation on `data` instead of rebuilding it repeatedly.

This pattern is mainly for raw config shapes or derived clips, not for every config-backed audio key by default.

### Audio time events (mid-clip timed cues)

Use audio **time events** when visuals must fire at specific moments *inside* a single
clip — not just at its start or end. Example: as a feedback clip says
"read the first syllable ... read the second syllable ... then blend them", each
syllable box scales up in reading order in sync with the narration.

**Mandatory trigger — do not drive narrated step-by-step visuals with a generic timer.**
Whenever a narration or feedback clip's script walks through ordered sub-steps — e.g.
"read the **first** syllable ... read the **second** syllable ... now **blend** them",
"point to each word", ordinal/positional callouts, or any per-item reveal that is meant
to land *with the voice* — you **MUST** synchronise those visuals to the clip with
`playTimedAudioKey` time-event cues. Do **not** instead animate them on a standalone
timeline (e.g. a generic `separateAndRejoinSyllables`/`stagger` helper that runs
independently of the audio) and do **not** just call `playAudioKey` and let the visuals
run on their own clock — that desynchronises the highlight from the spoken word and is the
most common mistake here. If that clip also has measured `wordTimings` in the asset
manifest, snap the cue `time` values to the relevant word start times (see below).

This is different from `createAudioEvents(clip)`, which only exposes whole-clip
`started` / `completed`. Time events fire at author-chosen millisecond offsets within the
clip.

Build the clip with `createTimedAudioOperation(data, key, { events, onAudioTimeEvent })`,
then play it with `playTimedAudioKey(data, key, { events, onAudioTimeEvent })`:

- `events`: an array of `{ time, id }` cue objects, where `time` is the offset in
  **milliseconds** from the start of the clip and `id` identifies the cue.
- `onAudioTimeEvent`: a callback invoked as `({ id }) => { ... }` when playback passes
  each cue's `time`. Look the cue up by `id` and drive the matching visual.

```js
const boxes = getSyllableBoxes(data);
const cues = boxes.map((box, index) => ({
    id: 'syllable-' + index,
    time: 900 + index * 700, // estimated offsets; see timing note below
}));

await playTimedAudioKey(data, 'blend_hint_feedback', {
    events: cues,
    onAudioTimeEvent: ({ id }) => {
        const index = cues.findIndex((cue) => cue.id === id);
        const box = boxes[index];
        if (!box || !box.isConnected) {
            return;
        }
        box.classList.add('is-voiced');
        // remove the class after a short hold, etc.
    },
});
```

`playTimedAudioKey` plays the clip and awaits its completion, so scene flow still blocks
on the clip finishing while cues fire along the way.

#### Prefer real word timings when the pipeline captured them

Some providers (currently ElevenLabs) return **measured** per-word timings during audio
generation. When present, the pipeline persists them on the audio asset in
`generated/<productCode>/refs/<refNum>/spec/asset_manifest.json` (and in the clip's
sidecar metadata JSON) as:

- `durationMs`: the clip's total spoken length in milliseconds
- `wordTimings`: an ordered array of `{ word, startMs, endMs }` (milliseconds from the
  start of the clip), with `[...]` audio-tag spans already stripped out

When the audio asset for a timed clip carries `wordTimings`, **snap cue `time` values to
those measured word start times** instead of guessing. Read `wordTimings` from the asset
manifest **while generating the module** and bake the resulting millisecond offsets into
the cue list as literals — the manifest is an authoring-time input, it is not loaded into
`data` at runtime, so do not invent a runtime lookup for it.

For example, if the manifest lists the clip `blend_hint_feedback` with
`wordTimings: [{ "word": "read", "startMs": 0, ... }, { "word": "the", "startMs": 360, ... }, { "word": "first", "startMs": 560, ... }, { "word": "syllable", "startMs": 1008, ... }]`,
map each visual cue to the word it should fire on and write that word's `startMs` directly:

```js
// Offsets copied from the clip's measured wordTimings in the ref asset_manifest.json.
const cues = [
    { id: 'syllable-0', time: 560 },  // fires on "first"
    { id: 'syllable-1', time: 1008 }, // fires on "syllable"
];

await playTimedAudioKey(data, 'blend_hint_feedback', {
    events: cues,
    onAudioTimeEvent: ({ id }) => {
        const box = getSyllableBox(data, id);
        if (!box || !box.isConnected) return;
        box.classList.add('is-voiced');
    },
});
```

Only fall back to the estimated/spacing pattern below when a clip has **no** `wordTimings`
(providers without native timestamps, uploaded audio, or older clips).

#### Timing is estimated when no measured timings exist

When there are no `wordTimings` for a clip, there is no ground-truth timestamp for "the
first syllable" inside it. Cue `time` values are then **estimates** the generated code
chooses (for example a first-cue offset plus a fixed spacing per item, or offsets provided
in module config). Whether cue times are measured or estimated:

- keep cue handlers **idempotent and defensive** — check the target element still exists
  and `isConnected` before animating; a slightly-off cue must never throw
- prefer subtle, self-resetting visuals (brief highlight/scale) over cues that hard-gate
  scene progression, so estimate drift degrades gracefully
- if module config already provides cue start times, use those instead of guessing
- do not block the scene on a cue firing; only block on the clip's `completed`

#### When time events do and do not fire

`createTimedAudioOperation` only wires `events` / `onAudioTimeEvent` when it builds the
clip from a URL or `customClipUrl` through `getPlayOperation(...)`. If the resolved config
entry is an **already-hydrated** playable object, the helper returns it as-is and the time
events are ignored. So:

- use time events for config/asset audio that resolves to a raw URL or `customClipUrl`
- do not assume time events fire on pre-hydrated playable config entries
- if a clip must emit cues, source it as a URL/`customClipUrl` string, not a hydrated
  playable

Use time events only when the scene genuinely needs mid-clip choreography. For simple
start/complete synchronization keep using `createAudioEvents(clip)`.

## Generated Music And SFX Tracks

Some audio tracks are generated as **background music** or **sound effects** rather than
speech. The pipeline marks these in the asset manifest / module inputs with playback
metadata:

- `kind`: `"music"` or `"sfx"` (speech tracks have no `kind`)
- `channel`: `"music"` or `"sfx"`
- `loop`: boolean (music defaults to `true`, sfx to `false`)
- `volume`: number in `0..1`

Treat that metadata as the source of truth. Do not guess loop/volume/channel.

### Background music tracks (`kind: "music"`)

Play music as a **looping background clip** on `channel: 'music'`, mirroring the runtime
`SetBackgroundAudioPlayable` (start / stop / pause / resume). Start it when its scene
begins and **stop it** when the activity or scene ends (or when switching to a different
background track). Do not `await` its completion — it loops under the foreground flow.

**Looping is a property of the playable descriptor, not a top-level request field.**
A clip built with the flat `getPlayOperation({ audioPaths, channel, volume })` form does
**not** loop — a top-level `loop: true` on that request is silently ignored and the music
stops after the first play-through. Instead, use the module runtime's native
`Activity.Media.Audio.getPlayOperation` API and put `loop: true` **inside** the
`playables[]` entry (the same audio shape used by `SetBackgroundAudioPlayable`):

```js
// Start looping background music (cache the operation so it can be stopped later)
data.backgroundMusicOp = Activity.Media.Audio.getPlayOperation({
    playables: [
        {
            type: 'path',
            path: resolveAudioUrl(data, 'ambient_music'),
            volume: 0.4,
            loop: true, // loop lives here, inside the playable
        },
    ],
    channel: 'music',
});
data.backgroundMusicOp.playAsync();

// Later, when the scene/activity ends:
if (data.backgroundMusicOp) {
    data.backgroundMusicOp.stop();
    data.backgroundMusicOp = null;
}
```

Do not call `Activity.Media.Audio.getAudioPlayOperation` from a generated module. That
name belongs to a simulator-facing facade; it is not exposed on the module runtime's
`Activity.Media.Audio` interface. Checking for it makes the native branch unreachable
and silently forces music onto a manual loop, which can lose playback when timeout or
navbar Repeat audio suspends the activity.

The engine loops seamlessly with no gap between passes and participates correctly in
the runtime pause/resume lifecycle. If you are targeting an older host that does not
expose `getPlayOperation`, fall back to re-playing a one-shot clip on its `completed`
event (build it **without** a loop flag so `completed` fires each pass, then call `play()`
again until you stop it).

### Sound-effect tracks (`kind: "sfx"`)

Play sfx as **one-shot** clips on `channel: 'sfx'`. Do not loop them. Fire-and-forget
unless the scene actually depends on their timing (then use `createAudioEvents`).

```js
const sfx = getPlayOperation({
    audioPaths: resolveAudioUrl(data, 'success_chime'),
    channel: 'sfx',
    volume: 1.0,
});
sfx.playAsync();
```

Use only audio keys that exist in the real manifest/config. Never invent keys.

#### SFX must play *with* the animation it accompanies — never after it

A sound effect that describes a visual event (a box snapping together, cargo thumping
into the truck, a confetti pop on arrival) has to be **heard while that visual happens**.
In the source prose the `<audio kind="sfx">` tag almost always sits on the line
*after* the animation/video it belongs to. Do **not** translate that ordering into two
sequential `await`s — that makes the sound land in the silence *after* the motion has
already finished, which is wrong.

**Start the sfx concurrently with the animation/video it accompanies:**

```js
// GOOD - sfx overlaps the merge animation
conveyor.classList.add('is-merged');
await Promise.all([
    sleep(MERGE_MS),
    playAudioKey(data, 'box_snap_sfx', { channel: 'sfx' }),
]);

// GOOD - sfx overlaps a stage video
await Promise.all([
    playStageVideo(data, 'arrival_video'),
    playAudioKey(data, 'arrival_sfx', { channel: 'sfx' }),
]);

// GOOD - fire-and-forget right as the visual work starts, then await the visual
element.classList.add('is-loading-hop');
playAudioKey(data, 'box_hop_sfx', { channel: 'sfx' }); // not awaited
await placeLoadedSyllableOnBelt(data, chosen, boxAsset);
```

**Anti-pattern — sfx awaited *after* the animation (plays too late):**

```js
// BAD - the ride finishes, THEN the thump plays in silence
await playStageVideo(data, 'conveyor_load_video');
await playAudioKey(data, 'cargo_thump_sfx', { channel: 'sfx' }); // too late
```

Only await an sfx *before* the next step when the effect is genuinely meant to land in a
quiet beat on its own (for example a short "try again" tone that precedes spoken
feedback). For any sfx that narrates a motion, start it together with that motion.

## Repeat Audio Patterns

For reminder or scaffolding loops:

- use `setRepeatAudio(...)`
- use `clearRepeatAudio()` when a new explicit prompt starts
- use `executeClearRepeatAudio()` when the helper flow needs to await repeat clearing before continuing

Repeat audio belongs to an active learner-interaction loop. A valid setup function must
either own the interaction (`Interactable`, `waitingForInput()`, unlocked input, or tap/select
handlers) or be called from the function that owns it. A timed pause for the learner to speak
without accepting runtime input is not an interaction and does not justify repeat audio.

Do not invent custom repeat plumbing if the existing WAF helpers already cover it.

### `setRepeatAudio` call shape

The `waf-utils` `setRepeatAudio(speech, languageCode)` helper takes the repeat clip as
its **first argument** and an optional language code as its second. `speech` may be:

- a **URL string** for the custom clip, or
- an object with a string `customClipUrl` (for example a raw config value like
  `{ customClipUrl: '<url>' }`), or
- an object already flagged with `isUsingCustomClip: true` and a string `customClipUrl`.

`waf-utils` wraps whatever you pass into the `{ speech: { ... } }` payload the runtime
expects, and the runtime (`prepAndSetRepeatAudio`) resolves the clip path itself. So pass
the clip source directly:

```js
// url is a raw (unresolved) path string; the runtime resolves it
setRepeatAudio(url, languageCode);

// or pass the raw config value when it is a customClipUrl-shaped object
setRepeatAudio({ customClipUrl }, languageCode);
```

To clear repeat audio, call `clearRepeatAudio()`.

Do not do either of these:

- Do not wrap the argument yourself as `setRepeatAudio({ speech: { ... } })`. That
  double-wraps the payload; `waf-utils` sees no usable `customClipUrl` and throws
  `The speech object isn't supported`.
- Do not run the source through an image/DOM URL resolver such as `resolveMediaUrl`
  before passing it. That resolver only understands `.src`/`.url` string shapes, so a
  `customClipUrl`-shaped or hydrated audio source collapses to an empty string. The
  runtime then builds an invalid playable and throws
  `AudioService: Received invalid configuration object`, followed by
  `Cannot read properties of undefined (reading 'createGain')`. Pass the raw clip source
  and let the runtime resolve the path.

When replacing one prompt with another:

1. clear the old repeat audio
2. play the new explicit audio
3. set the new repeat audio only if the scene needs it

## Input Locking Around Audio

Audio and input timing must be explicit.

Preferred rules:

- lock input while one-shot prompt or feedback audio is running if clicks should not interrupt it
- unlock only when the scene is ready for learner interaction
- if repeat audio or hint audio is interruptible, make the interruption path explicit
- every lock path must have a clear unlock path

Do not leave input state implicit around intro, prompt, or feedback audio.

### Activity-description interruptible marker

An audio cue followed immediately by `(interruptible)` is an explicit runtime requirement:

```text
<audio>Press and hold the correct word.</audio> (interruptible)
```

In `activity_spec.json`, this requirement is represented structurally by
`interruptible: true` on the matching `scene.audio.tracks` entry. The prose marker is
retained for legacy authoring compatibility, but generated behavior should use the
track metadata and key as its source of truth.

Only the marked cue is interruptible. Do not make earlier occurrences of the same script,
other prompts, or the whole scene interruptible unless they are marked too.

For a marked cue:

- arm the relevant tap/select handlers before starting playback
- unlock input while the cue is playing
- run the cue through `runInterruptedChains` from `waf-utils`
- register `clip.stop()` with the chain's `onAbort` callback
- call the returned scoped `interrupt` function from both accepted interaction paths,
  such as `onClick` for a tap and `onSelect` for a completed press-and-hold
- await the chain promise so normal completion and interruption rejoin the same scene flow
- after the chain promise resolves normally or through interruption, configure the marked
  cue as Repeat audio before awaiting the learner's answer/selection promise; otherwise the
  navbar Repeat button stays unavailable until the answer arrives
- preserve that repeat-audio setup while the interaction remains active
- when a tap interrupts the cue and then plays option/preview audio, restore the marked
  cue as repeat audio in the tap handler's `finally` block, after that preview finishes;
  setting repeat only when the interrupted chain resolves is too early and may be cleared
  by the preview playback
- guard that deferred `finally` restoration with an interaction-active flag; set the flag
  to false synchronously in the accepted selection handler before resolving the answer,
  locking input, or clearing Repeat, so a preview that finishes late cannot resurrect Repeat
  after the interaction has ended

Prefer the scaffolded `runInterruptibleAudioKey(data, key)` helper. It returns the
`{ promise, interrupt }` handle from `runInterruptedChains` and stops only its own clip.
Do not use `interruptActiveChains()` for a single prompt because that can abort unrelated
scene work.

Do not merely unlock input around an ordinary awaited `playAudioKey(...)`: the learner may
advance while the narration keeps playing. Do not arm selection only after awaiting the
marked cue, because early input will be lost or can reach an unset selection callback.
Do not await the armed answer/selection promise before configuring Repeat for the marked cue.
Do not let an outstanding tap/preview promise restore Repeat after selection or scene cleanup.

## Behavior-Level Guidance

When implementing prompts and hints:

- keep prompt audio separate from hint audio
- keep correct/incorrect feedback separate from selection logic
- store reusable audio handles on `data` only when that improves clarity
- prefer small helper functions when repeat/timing logic appears more than once
- if you cache config-backed audio on `data`, preserve the real runtime shape instead of forcing a string-only `audioMap`
- prefer one shared resolver/play helper instead of multiple direct `data.configuration.someKey.playAsync()` call sites

When using assets or config entries:

- keep key names literal and readable
- avoid wrappers that hide whether audio comes from `assets` or `configuration`

## Do Not Do These

- do not use speech synthesis
- do not access `data.configuration` through module-id indexing
- do not assume config audio entries are strings in modules that use default bootstrap hydration
- do not build a string-only `audioMap` from `data.configuration` unless `hydrateConfig: false` is intentionally in play and the real config shape requires it
- do not invent ad hoc audio object wrappers that differ from existing WAF audio objects
- do not mix `assets` and `configuration` sources without checking the real files first
- do not reference audio keys that are not present in config or definition assets
- do not spread repeated direct calls like `data.configuration.someKey.playAsync()` across scene code in generated modules when a resolver helper would be clearer and safer
- do not start repeat audio without a clear replacement/cleanup strategy
- do not configure repeat audio for narration, passive review, transitions, celebrations, or closing sequences that do not accept learner input
- do not wrap the `setRepeatAudio` argument as `setRepeatAudio({ speech: { ... } })`; pass the raw clip source (a URL string or a `customClipUrl`-shaped object) as the first argument and let `waf-utils` build the payload
- do not pre-resolve a repeat-audio source through an image/DOM URL resolver such as `resolveMediaUrl`; it drops `customClipUrl`/hydrated audio shapes to an empty string and the runtime resolves the path itself

## Final Self-Check

Before finishing:

- verify config shape is correct for the module
- verify no code indexes `data.configuration` by module id
- verify the module's `bootstrapSequence(...)` setup is compatible with the chosen audio access pattern
- verify every referenced audio key exists in real config/assets
- verify background music uses `Activity.Media.Audio.getPlayOperation` with `loop` on
  the playable descriptor; never emit `Activity.Media.Audio.getAudioPlayOperation`
- verify generated scene code uses a shared resolver/play helper when multiple prompt or feedback clips are played
- verify prompt and hint audio cannot start from `undefined`
- verify no cached audio map silently drops hydrated audio objects because it only accepts strings
- verify `playAsync()` vs `createAudioEvents(...)` usage matches the scene need
- verify every sfx that narrates a motion (snap, thump, hop, honk, confetti/arrival, drive-away) starts **concurrently** with that animation/video (fire-and-forget or `Promise.all`), and is never awaited *after* the animation/video completes
- compare the complete scene prose with the implementation and reason about the intended temporal relationship between each clip and each visual; do not reduce this check to a fixed vocabulary of phrases or animation verbs
- verify every visual tied to a point within a clip is driven by that matching track's `playTimedAudioKey` time-event cues, **not** a standalone animation timer, a bare `playAudioKey` running on its own clock, or an unrelated timed call elsewhere in the scene
- verify any mid-clip time events use `playTimedAudioKey`/`createTimedAudioOperation` with millisecond `{ time, id }` cues, snap cue times to the audio asset's measured `wordTimings` from `asset_manifest.json` when present (falling back to estimates only when absent), and keep cue handlers defensive (element exists and `isConnected`)
- verify repeat audio is cleared or replaced intentionally
- verify every repeat-audio setup is part of a learner-interaction flow, not merely placed after a spoken clip
- verify every active learner interaction with a repeatable prompt, hint, or feedback cue configures that exact cue as Repeat audio for the lifetime of the interaction; having no Repeat setup at all is a defect when such a cue exists
- verify input locking has a matching unlock path
- verify there is no speech synthesis code
