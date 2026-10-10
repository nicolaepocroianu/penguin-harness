# GSAP guidance in the scene composition skill

- **Date:** 2026-10-10
- **Type:** feat
- **Scope:** `plugins`

The scene composition skill now explains the timeline in GSAP terms:

- one storyboard frame at a time, with labels;
- tweens placed by the position parameter (absolute times, labels, `"<"`), never by appending,
  so editing one frame does not shift the others;
- shared defaults on the timeline;
- every starting state set at time 0, so seeking to 0 always shows the first picture;
- callbacks never used to draw;
- no ScrollTrigger, ticker code or tweens outside the timeline, since the recorder only seeks the
  one timeline.

Written for Penguin with GreenSock's official GSAP skills as a reference. Nothing is copied from
them: their folder in open-design carries no licence text.
