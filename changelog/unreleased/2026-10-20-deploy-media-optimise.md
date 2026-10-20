# A QA deploy shrinks the audio and video it ships, as Loom's deploy did

- **Date:** 2026-10-20
- **Type:** feat
- **Scope:** `server`, `web`
- **PR:** [#169](https://github.com/nicolaepocroianu/penguin-harness/pull/169)

The Publish the media stage (`verify_media_assets`) now re-encodes the audio and video the activity data names before it publishes them, with Loom's settings. A file already as a deploy ships it is left alone, so a second deploy re-encodes nothing. Re-encoded files replace the originals in the media clone and are committed with the rest of the referenced media.

## Details

- `.mp3`: kept when it is one MP3 stream, mono, 44.1 kHz, at most 64 kb/s (5% over is allowed), with no ID3v2 tag and no Xing or Info header. Otherwise it is re-encoded with LAME at 64 kb/s, mono, 44.1 kHz, with no Xing header and no ID3v2 tag.
- `.mp4`, `.m4v`, `.mov`: kept when it has one H.264 yuv420p stream at no more than 30000/1001 fps and 1000 kb/s (5% over is allowed), its index before its data (fast start), and at most one audio stream that is AAC mono 44.1 kHz at 64 kb/s or less. Otherwise it is re-encoded to H.264 at 1000 kb/s average, 1500 kb/s peak and a 3000 kb buffer, yuv420p, with fast start and AAC mono 44.1 kHz at 64 kb/s. The frame rate is brought down to 30000/1001 only when it is higher. A re-encoded `.mp4` also gets the brands the media repository's validator asks for: major brand mp42, compatible brands mp42 iso2 avc1 mp41, encoded by Waterford Media Framework.
- Images, fonts and anything else are left alone, as is a file outside the partial clone's folders.
- The deploy log names each re-encoded file with its size before and after and what that saved, and ends with the totals. The stage's metadata keeps the counts, the totals and the first files (`mediaOptimised`), and the stage row shows how many files were re-encoded and how much smaller they are.
- FFmpeg runs with none of the server's environment and, while activity agents are confined, through the session sandbox. It writes only into a work folder outside every clone (`<data root>/activity-deploy/media-work/<module>`), which is removed when the stage ends. Its output replaces the clone's file only after FFmpeg finished well.
- If FFmpeg is missing the stage fails as `command_missing` (`ffmpeg`) and publishes nothing. If a file cannot be read or re-encoded, the stage fails as `media_optimise_failed`, naming the files. Every original stays as it was, and nothing is published.
- What differs from Loom: Penguin reads FFmpeg's own description of the file, because the bundled FFmpeg has no ffprobe. The validator's MP4 brands are written in the same pass as the encode and patched in Penguin's own code, where Loom ran the media repository's `fix_videos_for_validator.sh --brand-fix-only` over each folder holding a re-encoded video, which needs bash. A missing FFmpeg fails the stage cleanly; in Loom it raised an unexpected error.
