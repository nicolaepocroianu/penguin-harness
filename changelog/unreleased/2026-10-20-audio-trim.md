# Audio is trimmed on the server and saved as MP3, as Loom trims it

- **Date:** 2026-10-20
- **Type:** feat
- **Scope:** `server`, `web`
- **PR:** [#170](https://github.com/nicolaepocroianu/penguin-harness/pull/170)

Trimming a speech clip in the Studio now happens on the server, through FFmpeg, and keeps the result as MP3 (libmp3lame, VBR quality 2, no metadata), the format Loom writes. Until now the browser decoded the clip, cut it and uploaded a WAV. A trim is previewed first and kept outside the media repository. Saving a trim of the current audio replaces that clip at the asset's own path, as Loom's trim of a saved clip does, and keeps its sidecar right.

## Details

- `POST …/activities/<id>/audio-trim-preview` takes the card (`language`, `assetKey`), a `source` and a range. The source is `bound`, `run` with `runId`, `upload` with `path`, or `preview` with `token` for a second cut. It answers `{ token, durationMs, savesInPlace }`. The preview is kept in Penguin's data root (`<project>/activity-audio-trims/<activity>/`), never in the media repository, and served from `GET …/audio-trim-previews/<token>`. Only a card's newest preview is kept, and none for more than a day.
- `POST …/audio-trim` (`language`, `assetKey`, `expectedRevision`, and either `previewToken` or `startSeconds` and `endSeconds`) replaces the bound clip in place, under the activity's draft lock.
  - **Stale previews:** a preview is saved only while the bound clip is still the one it was cut from (same path, same SHA-256). Otherwise the save is refused with 409 `audio_changed`.
  - **The file:** the MP3 goes to `media/loom/<pc>/<pc>-<ref>/audios/<language>/<key>.mp3`. A WAV take at the same key is removed with the trim.
  - **The sidecar:** it keeps what Loom keeps. `generationFingerprint`, `model`, `voice` and any other field stay, `fileName` and `text` are updated, and `wordTimings` is dropped. `durationMs` is measured from the trimmed clip.
  - **The manifest:** the entry loses `generatedAudio` and its timings and gets the new `durationMs`, so the draft's revision moves and whatever was made from the untrimmed clip is out of date.
- `POST …/audio-trim-previews/<token>/attach` stores a preview of anything other than the bound clip as an upload of the ref, to bind. Saving such a preview in place is refused with 409 `trim_preview_mismatch`. `POST …/audio-trim-upload` (`dataBase64`) trims a file that is not stored yet into a preview. It is Loom's route; the Studio uploads first, so it does not call it.
- A trim removes the selected stretch and keeps the rest, as Loom's does. The range is in seconds:
  - the start must be 0 or more;
  - the stretch must be at least 0.05 s long;
  - the start must come before the clip's end;
  - some audio must remain;
  - an end past the clip means the clip's end.

  Anything else is 400 `trim_range_invalid`. Other refusals: a stale revision is 409 `draft_conflict`, an asset without audio (or a language that is not one of the manifest's own) is 404, a failed encode is 502 `audio_trim_failed`, and a missing FFmpeg is 503 `ffmpeg_missing`.
- **Safe writes:** FFmpeg runs outside the lock. Under it, the new files are written beside their targets and swapped in, and the old ones are kept until the draft is written. If the draft write fails, the old ones are put back.
- **Precision:** the cut is sample-accurate (`atrim` and `concat`), where Loom's `aselect` drops whole decoded frames. The MP3 is written to a file, not a pipe, so it carries the header that tells a player how long a VBR clip is. A clip's length is measured by decoding it at 1 kHz, so a long clip costs little memory.
- **In the Studio:**
  - A selection's two edges can be dragged.
  - A trim of any clip becomes the card's candidate, played from its preview.
  - Save replaces the current audio when the trim was cut from it, and otherwise attaches the trim and binds it.
  - Save waits while other edits are still saving, and says so.
  - After a trim, the current clip's address changes with its length, so the player loads the trimmed clip.
  - Discarding the candidate leaves the saved audio as it was.
- A change the Studio refuses before it is sent (unsaved edits under an agent's proposal) now shows its own message instead of "Request failed".
