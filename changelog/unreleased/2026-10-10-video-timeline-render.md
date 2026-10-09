# Rendering a scene video's timeline

- **Date:** 2026-10-10
- **Type:** feat
- **Scope:** `server`

A scene video's timeline (behind the scene video experiment) can now be rendered to its finished
video. `POST .../render-timeline` takes the timeline saved on the video, or the one started from
its newest recording, and FFmpeg puts the video together in one pass:

- The cuts are trimmed from their recordings, letterboxed to the timeline's size and frame rate,
  and joined straight on or crossfaded (plain or through black).
- Narration and effects are placed at their start times. The music loops when its asset loops,
  fades in and out, and turns down while narration speaks. Everything is mixed to the video's
  length and brought to -16 LUFS.
- The result is an H.264/AAC MP4. When the narration has word timings, its captions are written
  beside it as WebVTT.

The render is a video run like a recording, marked `fromTimeline`, and is kept the same way: Use
new binds it to the asset, with its captions as `<name>.vtt` beside the video. A finished video is
never what a new timeline starts from. Rendering is refused with `timeline_blocked` while the
timeline names audio that is missing, of the wrong kind or not generated yet.

Keeping a video over another now leaves the replaced one readable: it goes back to its run's
candidate in the media repository. A timeline can still cut from a recording after its finished
video has replaced it.

`PUT .../video-timeline` saves a timeline on its video (422 `timeline_invalid` with what is
wrong), or with `timeline: null` drops it. `GET .../runs/:runId/captions` serves a video run's
captions as WebVTT.
