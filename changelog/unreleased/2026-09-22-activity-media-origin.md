# Serving media to a running preview

- **Date:** 2026-09-22
- **Type:** feat
- **Scope:** `server`

Loom proxies `/media/*` out of its media clone with range handling tuned for `<video>`.
Penguin serves the same thing from the draft's own media directory, which is what makes a
newly saved file appear in the preview without another assembly run.

The response assembly is separate from the filesystem, because the header arithmetic is
where range serving actually goes wrong and a partial response whose `Content-Range`
disagrees with its `Content-Length` is a bug no happy-path test would find.

## Decisions worth knowing

**A content type is named or it is bytes.** Anything not on the list is
`application/octet-stream` rather than a guess: a player handed the wrong type fails in
ways that look like a broken file, and sniffing is what `nosniff` exists to prevent.

**The validator covers size and modification time**, which is what `If-Range` compares. A
range is honoured only while the client is still looking at the file it last saw —
otherwise a video plays two halves of two different takes.

**Nothing is cached.** A draft's media changes under the same URL, so every response is
`private, no-store` and validated on its own terms.

**304 beats a range.** A client that already has the exact bytes does not need part of
them.

**A range outside the file is a 416** carrying the real size, not a whole-file response. A
player given 200 for a range it cannot use seeks forever.
