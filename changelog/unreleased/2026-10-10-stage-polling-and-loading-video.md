# Quicker stage hand-offs and no missing loading animation

- **Date:** 2026-10-10
- **Type:** perf
- **Scope:** `server`

The Stages sequence now checks a run it waits on after 100 ms, then 200, 400 and 800 ms, before
settling at once a second. It used to wait a full second every time, so each speech clip, image
or word recording, most of which finish within a second, cost about a second of waiting.
A 30-narration activity's speech stage loses about half its time. Clips still run one after
another: each is accepted against the draft it was made from, so clips made side by side would
refuse each other.

The preview page fetches the WAF media checkout's `videos/loading` folder with the activity's
media, as a best effort, and shows the loading animation only when the file is there. A checkout
without it used to answer every preview's request for it with a 404, which filled the error log.
