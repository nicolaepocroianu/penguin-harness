# Scene videos are checked for flashing

- **Date:** 2026-10-10
- **Type:** feat
- **Scope:** `activities`

The final check of a scene video now measures each frame's brightness with FFmpeg's `signalstats`.
A video flashes when it has more than three flashes in any one second, following WCAG 2.3.1's
general flash threshold: each flash is a pair of opposing changes of at least a tenth in relative
luminance, with the darker side under 0.8. A video that flashes fails the check with an error, since
flashing can cause seizures, and composing the scene again tells the agent to remove the flashing.
The check reads the whole frame's average, so a flash in a small part of the picture can be missed.

FFmpeg's analysis report now keeps up to 32 MB, collected without copying it again for every chunk,
so the brightness of a long video's frames does not push out the report's header.
