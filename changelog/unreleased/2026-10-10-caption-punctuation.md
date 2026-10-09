# Captions keep the narration's punctuation

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `server`

A scene video's captions were written from the narration's word timings alone. ElevenLabs'
timings come without punctuation, so a caption read "Each treasure is a letter Listen and find"
and never broke at a sentence's end. Each timed word now takes its spelling and punctuation from
the matching word in the narration's script, so the captions read "Each treasure is a letter." and
"Listen and find the right letter!". A timed word that the script does not have keeps its own
form. Found by rendering test16's scene 2.
