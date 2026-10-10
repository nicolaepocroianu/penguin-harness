# Finished videos play with their captions in the studio

- **Date:** 2026-10-10
- **Type:** feat
- **Scope:** `server`, `web`

A finished scene video whose narration had word timings already kept its captions as WebVTT
beside it. The studio now plays them: the comparison offering a new finished video, and the
asset's bound video, add the captions as a track, shown by default and labelled "Captions" in the
player's menu.

A video run now records `captions: true` on its target when captions were kept, so the studio
knows which videos have them without reading each run's result. Videos without captions get no
track, so nothing asks for captions that are not there.
