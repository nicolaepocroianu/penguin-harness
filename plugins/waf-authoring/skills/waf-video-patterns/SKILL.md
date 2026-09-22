---
name: waf-video-patterns
description: Use when implementing or reviewing pipeline-generated WAF HTML modules that include video assets. Covers playback wiring, last-frame persistence, and cleanup rules for video elements in sequence flow.
---

# WAF Video Patterns

Use this skill when authoring or reviewing behavior in generated WAF HTML modules that include video assets.

## Playback Wiring

When a stage has video assets:

- in State machine modules, obtain the real video key from
  `data.sceneCatalog.scene(sceneId).videoKeys`; do not duplicate video-key arrays
- in legacy sequence modules, use module configuration or scaffolded stage metadata constants
- wire playback through the existing WAF media helpers
- preserve the scaffolded `createVideoOperation(data, key, options)` cache; reuse the
  same WAF operation for a resolved video URL and channel instead of constructing a new
  operation every time a repeated exercise or scene plays that video
- keep `playsinline` and `preload="auto"` on every cached operation's video element
- do not fake a provided video with a static painted frame plus CSS transitions

Full-stage video must fill its intended media container instead of rendering at its
intrinsic pixel dimensions. Size both the layer and its direct video child:

```scss
.activity-video-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.activity-video-layer > video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
```

Use an intentional `object-fit`; `cover` is the normal full-stage choice. If hotspots
must align to video coordinates, place the video and hotspots inside the same media plane
and size that plane according to `waf-style-guardrails` rather than positioning hotspots
against a differently proportioned stage.

Before replaying a cached operation, reattach its video element to the current video layer
if needed, await `waitForVideoReady(videoElement)`, and reset `currentTime` to `0` when it is
greater than zero. Keep the previous video's final frame mounted until the replacement emits
the native `playing` event. Readiness or `canplay` is not sufficient because the browser may
still delay presenting motion. For a different incoming video element, mount the incoming
layer with `visibility: hidden`, arm `waitForVideoPlaying(videoElement)` before `playAsync()`,
then reveal the incoming layer and remove the previous frame in the same handoff after
`playing` resolves. When the cache returns the same connected video element, keep it in its
existing visible layer and replay it in place; do not move the sole element into a hidden
replacement layer. This same-element exception avoids exposing the cover or empty root while
preserving one cached operation per URL and channel.

```js
const sameElementHandoff =
    previousVideoElement === videoElement && videoElement.isConnected;
if (!sameElementHandoff) {
    replacementLayer.classList.add('is-video-replacement-pending');
    replacementLayer.appendChild(videoElement);
}

const playingPromise = waitForVideoPlaying(videoElement);
const playPromise = operation.playAsync();

await Promise.race([playingPromise, playPromise]);
if (!sameElementHandoff) {
    replacementLayer.classList.remove('is-video-replacement-pending');
    if (previousVideoElement) {
        previousVideoElement.remove();
    }
}
data.currentVideoEl = videoElement;

await playPromise;
```

Preserve the scaffolded `waitForVideoReady` listeners for `loadeddata`, `canplay`,
`seeked`, and `error`. Rewinding a completed element can temporarily lower `readyState`.
If the readiness wait listens only for `loadeddata`, replay can hang on the first frame
because `loadeddata` does not fire again when the seek completes.

Different logical video keys can resolve to the same URL and channel, especially while
placeholder media is still in use. In that case the cache returns the same operation and
the same `videoElement`. Keep that connected element in its visible layer and replay it there
instead of reattaching it to a hidden replacement. For different elements, remove the
persisted previous element only after the replacement emits `playing`, then clear the stale
persisted reference separately. Removing or hiding the same node that is being replayed
causes a blank handoff or aborts `playAsync()`.

Do not call `operation.pause()` or `videoElement.pause()` before `playAsync()`. A WAF video
operation owns the media lifecycle; directly pausing its element during readiness or rewind
desynchronizes that operation and can leave playback stuck, paused at `currentTime === 0`.
Rewind an already completed cached clip by assigning `currentTime = 0` only.

When a scene lists a video cue before a later audio cue, video-first is the default:

- play the video asset to completion first
- leave the final video frame visible as the scene backdrop
- then append narration overlays or start follow-up narration
- do not treat adjacent video and audio cues as overlapping just because they are in the same scene

Typical video-first shape:

```js
await playStageVideo(data, 'scene-door-open-video');

data.overlayLayer.appendChild(sceneOverlay);
await playAudioKey(data, 'scene-narration-audio');
```

Use this pattern for scenes where the video establishes the visual state, such as a door opening, a truck arriving, or a character leaving, and the narration explains the now-visible final state.

When the complete meaning of the scene establishes that audio belongs within the video's playback interval:

- treat that as intentional overlapping playback, not as two sequential steps
- infer the relationship from the full scene context; do not use a fixed keyword list as a classifier
- keep the video running and start the audio in parallel instead of waiting for the video to finish first
- if the script says the audio starts later while the video is already playing, model that as delayed overlapping playback rather than as a second standalone scene step
- prefer one helper that owns the combined timing so the sequence waits for the full intended media beat before advancing

Preferred overlap pattern:

1. create the real video operation through the existing helper
2. start video playback immediately and keep the returned promise
3. if audio should begin at the same time, start the audio promise immediately in parallel
4. if audio should begin after a delay, wait only for that delay and then start the audio while the video continues playing
5. wait for both the video playback and the overlapping audio playback to complete before advancing the sequence

Typical shape:

```js
const playPromise = videoOperation.playAsync();

await Promise.all([
    playPromise,
    (async () => {
        await waitForDelay(audioDelayMs);
        await playAudioKey(data, audioKey);
    })(),
]);
```

If the audio should start with no delay, omit the delay wait and start the audio immediately in the parallel branch.

Do not stop, hide, replace, or restart the video just to make room for the audio.

If the implementation needs an explicit playback channel for the video or audio operation, pass it through the existing media helper options instead of bypassing the helper layer.

## Playback-Synchronized Choreography

When CSS or DOM choreography must start with the video's visible motion, synchronize it to the native `playing` event. Calling `playAsync()` requests playback but does not prove that the browser has presented moving video.

Use the scaffolded `waitForVideoPlaying(videoElement)` helper and arm the playing wait before calling `playAsync()` so a fast playback start cannot be missed:

```js
const playingPromise = waitForVideoPlaying(videoElement);
const playPromise = videoOperation.playAsync();

await playingPromise;
const choreographyPromise = startCargoRide();

await Promise.all([playPromise, choreographyPromise]);
```

Keep readiness and playback synchronization separate:

- use `waitForVideoReady` before `playAsync()` to wait for initial media data
- use `waitForVideoPlaying` around `playAsync()` only when another visual clock must start with actual playback
- use `currentTime` / `timeupdate` for cues that must occur at a specific point inside the video

Do not start synchronized CSS animation immediately before `playStageVideo()`, from the `playAsync()` call itself, or from a generic parallel callback that runs before the native `playing` event.

## iPad-Safe Startup And Handoff

On iPad, Chrome and Safari both use WebKit. When a video is the activity's first
visual, prepare and render that real video before configuration hydration. Give
it a poster matching its first frame so the learner sees a real visual while
the remaining assets load. Use the supported `beforeHydrate` bootstrap hook;
do not copy or replace the bootstrap.

Keep `index.js` environment-neutral and pass one named preparation function.
Loom preview changes hydration at its module-bundling boundary, while QA and
release retain the `waf-sequence` eager-hydration default:

```js
import sequence, { prepareStartupVideo } from './sequence';

bootstrapSequence(sequence, {
    beforeHydrate: prepareStartupVideo,
});
```

The hook mounts one WAF video operation, waits for its initial data, and stores
that operation for the first scene to reuse:

```js
export async function prepareStartupVideo({ data }) {
    initializePreviewStart(data, PREVIEW_STAGE_IDS);

    if (data.previewStartSceneId && data.previewStartSceneId !== 'scene-1') {
        return;
    }

    ensureStage(data);

    const key = 'scene-intro-video';
    const operation = createVideoOperation(data, key, {
        posterKey: 'scene-intro-cover',
    });

    if (!operation) {
        return;
    }

    const videoElement = mountStageVideo(data, key, operation);
    data.currentVideoEl = videoElement;
    data.preparedVideo = { key, operation };

    await waitForVideoReady(videoElement);
}
```

The normal first-scene video helper must consume `data.preparedVideo` when its
key matches instead of creating a second operation. Preserve the scaffolded
`waitForVideoReady` helper: return immediately for `readyState >= 2`; otherwise
listen for `loadeddata`, `canplay`, `seeked`, and `error`, then clean up every
listener. Resolve the poster URL and set it directly on the real video element
so this works before definition images are hydrated. Do not set `autoplay`
or add `requestVideoFrameCallback`, visibility gates,
hidden video elements, separate poster DOM, or video-specific release helpers.
If dev preview starts at a later scene, skip opening-video preparation so the
preview router can establish that scene's own backdrop.

Do not start a separate audio operation in the same call stack as an opening
video's `playAsync()`. Concurrent media startup can intermittently fail the
video element on iPad WebKit. When the opening video already has its own audio
track, let that self-contained clip finish and then start the activity's
looping background music. Only overlap separate audio when the script
explicitly requires it; in that case, begin it after video playback is
confirmed rather than from an immediate `onStart` callback.

## Last-Frame Persistence

When a video finishes playing, keep its last frame visible on screen by default.

Do not remove, hide, or reset the video element after playback completes unless the script explicitly instructs removal or a scene transition replaces it with new content.

Preferred pattern:

1. play the video asset through the real WAF media helpers
2. on playback completion, leave the element in the DOM showing its final frame
3. only remove or hide the video element when:
   - the prose explicitly says to clear or hide the video
   - the entire scene is cleaned up for a new scene that replaces it
   - the activity ends

This means the learner continues to see the last frame of the video as a static visual backdrop until the next scene transition or until the script explicitly removes it.

## Cleanup Rules

Video elements follow the same cleanup-boundary principle as other rendered elements, with one exception: their removal is deferred to the next explicit scene transition rather than happening immediately after playback.

When a scene transition does occur:

- render the replacement hidden before starting playback
- arm `waitForVideoPlaying` before `playAsync()`
- reveal the replacement and remove the previous video only after the native `playing` event
- compare DOM element identity and do not remove an element if the media helper reused that same element
- clear the persisted-element reference even when the current and previous elements are identical
- do not leave orphaned video elements across unrelated scenes

If media playback rejects with `AbortError`, treat it as cancellation only when the
current action's abort signal is actually aborted. Browsers also use `AbortError` when a
playing media element is removed from the document; that must follow the normal
scene-effect failure path so the state machine cannot stall waiting for a completion event.

## Anti-Patterns

Do not:

- remove or hide a video element immediately after playback completes unless the script explicitly says to
- create separate poster DOM, hidden-video, or first-frame systems
- set `autoplay` instead of explicitly waiting for `loadeddata` before `playAsync()`
- copy or replace the `waf-sequence` bootstrap instead of using `beforeHydrate`
- put the cover or video key in `prerequisites`
- reset the video to its first frame after playback
- replace the video element with a static screenshot of the last frame — the native element already shows it
- fake a provided video with CSS keyframes, transform loops, or shimmer effects
- invent video asset keys that do not exist in the real module files
- use `playStageVideo(..., { during: ... })` merely because a scene contains both a video and narration
- serialize overlapping media by doing `await playVideo(); await playAudio();` when the script says the audio happens during the video
- split one intended audio-over-video moment into unrelated scene steps that make the sequence timing harder to reason about
- restart a video midway through just because a delayed audio cue begins
- start video-synchronized CSS or DOM choreography from `playAsync()` invocation instead of the native `playing` event
- create a second ad hoc media path outside the established helpers when a small helper option or wrapper can coordinate the overlap cleanly
- replace or bypass the scaffolded video-operation cache in a scene-local video helper
- call `operation.pause()` or `videoElement.pause()` as part of readiness or rewind immediately before `playAsync()`

## Review Checklist

Before finishing, verify:

- when the first visual is a video, its matching cover URL is set as the real
  video's poster before the element is rendered
- `index.js` remains environment-neutral and passes the named startup
  preparation function through `beforeHydrate`
- the first scene reuses the prepared WAF operation instead of creating another
  video element
- dev preview of a later scene skips opening-video preparation
- the rendered opening video awaits `waitForVideoReady` before `playAsync()`
- video-synchronized choreography arms and awaits `waitForVideoPlaying` before starting its own animation clock
- every video asset is played using its real asset key
- repeated playback reuses the scaffolded cached WAF operation, reattaches its element,
  waits for readiness, and rewinds it before `playAsync()`
- full-stage video layers and their direct video children fill the activity, and the video
  uses `display: block`, `width: 100%`, `height: 100%`, and an intentional `object-fit`
- coordinate-aligned hotspots share the video's media plane
- readiness and rewind code does not pause the WAF operation or its video element before `playAsync()`
- every video element retains `playsinline` and `preload="auto"`
- an opening video with its own audio track finishes before separate looping background music starts
- no immediate `onStart` callback launches a second media operation alongside the opening video's `playAsync()`
- video elements retain their last frame on screen after playback unless explicitly removed by the script
- video cleanup only happens at scene boundaries or when the prose explicitly requires it
- no orphaned video elements persist across unrelated scenes
- when the scene meaning does not establish overlap, the implementation waits for the video to finish before starting narration or appending narration-only overlays
- when the prose says audio happens during a video, the implementation starts that audio in parallel with the video instead of after it
- when the prose says the audio starts after a delay while the video continues, the implementation uses delayed overlapping playback rather than a fully sequential follow-up step
- the sequence waits for the full overlapping media beat to finish before advancing
