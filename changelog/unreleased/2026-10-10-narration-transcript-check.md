# Finished videos are checked for what their narration says

- **Date:** 2026-10-10
- **Type:** feat
- **Scope:** `server`, `web`

When a scene video's timeline is rendered (the scene video experiment) and it has narration, its
final check now also listens to it. Penguin pulls the sound out with FFmpeg and transcribes it
with Whisper, running locally through the same Transformers runtime as the local music models. It
uses the English model for English narration and the multilingual one otherwise. What is heard is
compared word by word, in order, with the scripts of the narration the timeline plays:

- under 90% of the script's words heard is a warning naming the words that could not be heard;
- punctuation read aloud ("dot", "comma") where the script does not say that word is an error.

Both show with the video's other findings. Where the Transformers runtime is not installed,
nothing is transcribed and the rest of the check is unchanged. The Whisper model downloads into
the server's models folder the first time it is used.

`LocalAudio` gains `canTranscribe` and `transcribe`; transcription takes its turn with the other
local models, since only one may occupy memory at a time.

The idea is the transcript check in OpenMontage's final review, as an idea only.
