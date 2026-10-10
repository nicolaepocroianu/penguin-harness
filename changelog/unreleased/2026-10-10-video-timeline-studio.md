# The scene video's timeline in the studio

- **Date:** 2026-10-10
- **Type:** feat
- **Scope:** `web`, `server`

Once a scene has a recording, the Scene video section (behind the scene video experiment) shows
its Timeline: how long it plays, and whether it is saved on the video or started from the newest
recording. The author can change, for each cut, where it starts and ends in the recording and how
it begins (Cut, Crossfade or Fade through black, with the fade's length). They can also change:

- when each narration starts, and add or remove narration;
- the music, its volume, and whether it lowers under narration;
- the sound effects, when they play and how loud;
- whether captions are written.

Times are typed in seconds, and a field that does not hold a number says so.

Save timeline saves it on the video, and Start from the recording again drops it. What the server
reports the timeline would get wrong is listed in the App's words. Render finished video is
offered once the timeline is saved and names no audio that cannot play. The finished video then
appears under Recordings, marked Finished video, and the usual comparison offers Use new.

The server's API types now export the timeline's types.
