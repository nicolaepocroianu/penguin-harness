# Scene videos rendered frame by frame to MP4

- **Date:** 2026-10-10
- **Type:** feat
- **Scope:** `server`, `web`, `desktop`

Record video (the scene video experiment) no longer plays the composition in real time under
Playwright's page recorder. It pauses the composition's timeline and steps through it frame by
frame at 30 frames a second, taking a screenshot of each, and FFmpeg encodes the frames as an
H.264 MP4. A recording has no blank lead-in any more, every frame is the timeline's own, and a
slow machine renders slower instead of dropping frames. The studio's note under Record video now
says that rendering takes a while for a long animation.

New recordings are kept and bound as `.mp4`, with `format: "mp4"` on the asset's
`generatedVideo`. Recordings kept before this change stay WebM and keep working: a binding
without a format is read as WebM.

FFmpeg now ships with Penguin. The server has `ffmpeg-static` as an optional dependency, and the
desktop app stages its binary beside the server bundle. The server runs `PENGUIN_FFMPEG_PATH` when
set, then the bundled binary, then `ffmpeg` from PATH; the MP3 conversion of generated speech uses
the same lookup. The binary is GPL and runs as a separate program; THIRD-PARTY-NOTICES.md records
its license and where its source is.

The seek-and-capture loop and the encode follow open-design's deterministic frame renderer
(Apache-2.0).
