# Scene video timelines

- **Date:** 2026-10-10
- **Type:** feat
- **Scope:** `server`

A scene video (behind the scene video experiment) can now carry a timeline: how its finished
video is put together. A timeline lists the recordings that play, one after another, each with
where it is cut and whether it fades in from the one before. It also lists the narration clips and
when each starts, the background music with its volume, fades and whether it turns down while
narration speaks, the sound effects and when they play, and whether captions are written and how
long each may be. Every time is in milliseconds. The shape follows OpenMontage's edit decisions,
as an idea only; no code is taken from it.

The timeline is kept on the video or animation asset in the media plan (`timeline`), so it is
saved with the plan, carried across a re-plan, and never written into the module's asset
manifest. A translated language starts without one. Saving a malformed timeline is refused with
what is wrong; what it refers to is only reported: a missing or unbound audio asset, one of the
wrong kind, a narration whose length is unknown, narrations that overlap, audio past the end of
the video, and captions on narration without word timings.

`GET /api/projects/:projectId/activities/:activityId/video-timeline?language=&assetKey=` answers a
video's saved timeline, or else one started from its newest recording: the recording whole, the
scene's narrations one after another from half a second in, the scene's music turned down under
them, and captions on. It answers 409 `video_recording_missing` when there is neither.

Captions are cut from the narration's word timings, at most 8 words or 42 characters each with a
sentence's end closing its caption, and written as WebVTT. Rendering a timeline, and the studio's
view of it, come next.
