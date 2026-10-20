# Audio is trimmed on the server and saved as MP3, as Loom trims it

- **Date:** 2026-10-20
- **Type:** feat
- **Scope:** `server`, `web`
- **PR:** [#170](https://github.com/nicolaepocroianu/penguin-harness/pull/170)

Trimming a speech clip in the Studio now happens on the server, through FFmpeg, and keeps the result as MP3 (libmp3lame, VBR quality 2, no metadata), the format Loom writes. Until now the browser decoded the clip, cut it and uploaded a WAV. Saving a trim of the current audio cuts the same stretch out of that clip at the asset's own path, as Loom's trim of a saved clip does, and keeps its sidecar right.

## Details

- `POST …/activities/<id>/audio-trim` (`language`, `assetKey`, `startSeconds`, `endSeconds`, `expectedRevision`) trims the bound clip in place, under the activity's draft lock. The MP3 goes to `media/loom/<pc>/<pc>-<ref>/audios/<language>/<key>.mp3`. The sidecar keeps what Loom keeps: `generationFingerprint`, `model`, `voice` and any other field stay, `fileName` and `text` are brought up to date, and `wordTimings` goes. `durationMs` is the trimmed length; Loom drops it. The manifest entry loses `generatedAudio` and its timings and gets the new `durationMs`, so the draft's revision moves and whatever was made from the untrimmed clip is out of date.
- `POST …/audio-trim-preview` (`source`: `bound` with `language` and `assetKey`, `run` with `runId`, or `upload` with `path`) and `POST …/audio-trim-upload` (`name`, `dataBase64`) store the trimmed clip as an MP3 upload of the ref and answer it with its length. Neither changes the draft.
- A trim removes the selected stretch and keeps the rest, as Loom's does. The range is in seconds: the start must be 0 or more, the stretch at least 0.05 s long, the start before the clip's end, and some audio must remain; an end past the clip means its end. Anything else is 400 `trim_range_invalid`. A stale revision is 409 `draft_conflict`, an asset without audio 404 `audio_missing`, a failed encode 502 `audio_trim_failed` and no FFmpeg 503 `ffmpeg_missing`. The clip and its sidecar are written beside their targets and renamed into place only once both are written, so a failure leaves them as they were.
- The cut is sample-accurate (`atrim` and `concat`), where Loom's `aselect` drops whole decoded frames. The MP3 is written to a file, not a pipe, so it carries the header that tells a player how long a VBR clip is.
- In the Studio, a selection's two edges can be dragged to move them. A trim of any clip becomes the card's candidate. Save trims the current audio in place when the candidate is a trim of it, and binds the file otherwise. Discarding the candidate leaves the saved audio as it was.
