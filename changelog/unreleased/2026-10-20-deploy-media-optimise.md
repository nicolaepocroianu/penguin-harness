# A QA deploy shrinks the audio and video it ships, as Loom's deploy did

- **Date:** 2026-10-20
- **Type:** feat
- **Scope:** `server`, `web`
- **PR:** [#169](https://github.com/nicolaepocroianu/penguin-harness/pull/169)

The Publish the media stage (`verify_media_assets`) now re-encodes the audio and video the activity data names before it publishes them, with Loom's settings. A file already as a deploy ships it is left alone, so a second deploy re-encodes nothing. Re-encoded files replace the originals in the media clone and are committed with the rest of the referenced media.

## Details

- `.mp3`: kept when it is one MP3 stream, mono, 44.1 kHz, at most 64 kb/s (5% over is allowed), with no ID3v2 tag and no Xing or Info header. Otherwise it is re-encoded with LAME at 64 kb/s, mono, 44.1 kHz, with no Xing header and no ID3v2 tag.
- `.mp4`, `.m4v`, `.mov`: kept when it has one H.264 yuv420p stream at no more than 30000/1001 fps and 1000 kb/s (5% over is allowed), its index before its data (fast start), and at most one audio stream that is AAC mono 44.1 kHz at 64 kb/s or less. Otherwise it is re-encoded to H.264 at 1000 kb/s average, 1500 kb/s peak and a 3000 kb buffer, yuv420p, with fast start and AAC mono 44.1 kHz at 64 kb/s. The frame rate is brought down to 30000/1001 only when it is higher. A re-encoded `.mp4` also gets the brands the media repository's validator asks for: major brand mp42, compatible brands mp42 iso2 avc1 mp41, encoded by Waterford Media Framework.
- An `.mp4` that is already as above but lacks those brands gets them without being re-encoded: FFmpeg copies its streams into a new file, as the media repository's brand fix does. A `.mov` or `.m4v` never gets MP4 brands, as in the brand fix.
- Images, fonts and anything else are left alone, as is a file outside the partial clone's folders.
- The deploy log names each re-encoded file with its size before and after and what that saved, and ends with the totals. The stage's metadata keeps the counts, the totals and the first files (`mediaOptimised`), and the stage row shows how many files were re-encoded and how much smaller they are.
- FFmpeg runs with none of the server's environment and, while activity agents are confined, through the session sandbox. It writes only into a work folder outside every clone (`<data root>/activity-deploy/media-work/<module>`), which is removed when the stage ends. When the data names no audio or video, FFmpeg is not run and no sandbox is needed. FFmpeg is told to write no progress while it encodes, and a failure's reason keeps only the end of what it wrote.
- FFmpeg's output replaces the clone's file only after FFmpeg finished well, and only if the file is still the one FFmpeg read. A take accepted into the media clone during the encode is never overwritten: the stage fails as `media_changed`, and deploying again re-encodes the new take.
- If FFmpeg is missing, the stage fails as `command_missing` (`ffmpeg`). A file that is only a Git LFS pointer fails as `media_lfs_pointer`, because its content cannot be checked or re-encoded, just as Loom's ffprobe could not read it. A re-encoded copy that cannot be put in place fails as `media_write_failed`, with the OS error (a busy rename is tried once more first). Any other file that cannot be read or re-encoded fails as `media_optimise_failed`. In each case every original stays as it was, and nothing is published.
- What differs from Loom:
  - Penguin reads FFmpeg's own description of the file, because the bundled FFmpeg has no ffprobe. That description rounds the frame rate to two decimals, so a variable-frame-rate video averaging 29.9701 to 29.9749 fps counts as 29.97 and is kept, where Loom re-encoded it.
  - Loom ran the media repository's `fix_videos_for_validator.sh --brand-fix-only` over every `.mp4` in each folder holding a re-encoded video, which needs bash. Penguin writes the brands in its own code, into each `.mp4` the data names, whether or not it was re-encoded.
  - A missing FFmpeg fails the stage cleanly; in Loom it raised an unexpected error. An LFS pointer and a file changed during the encode have their own failures; in Loom they failed as ffprobe errors or went unnoticed.
