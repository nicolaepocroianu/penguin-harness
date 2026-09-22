# What the dev sandbox has to decide

- **Date:** 2026-09-22
- **Type:** feat
- **Scope:** `server`

Loom's sandbox is a separate Express server on its own port, reverse-proxied by the
backend. Penguin's will be Hono routes inside the server it already runs, spawning the
module's own webpack build as a managed child — no second HTTP server and no proxy layer,
so the auth, session and preview-token machinery already in place stays in place.

This is everything that sandbox has to decide without a socket or a child process, written
first because these are the parts a running server hides when they are wrong.

## Freshness

A build is stale when any source is at least as new as it. Compared with `>=`, not `>`: a
file written in the same millisecond the build finished is a file the build may not have
read, and rebuilding a current module costs a moment while serving a stale one costs an
author's trust in the preview.

## Preview state

Loom's own vocabulary, so the two stay comparable: `pending_spec`, `pending_scaffold`,
`missing_shared_module`, plus `stale` and `ready`.

The shared-module check comes **before** the scaffold check. A ref that does not own the
module cannot build it, so reporting a missing scaffold would send an author to a button
that has to refuse them.

A stale module still plays. Saying so is better than withholding it.

## Byte ranges

Video seeking needs them, and the details are where this goes wrong:

- `bytes=-500` is the **last** 500 bytes, not the first.
- An end past the file is clamped — a player asking for more than exists still wants what
  exists.
- A start past the end is **refused**, as a 416. A player given a whole file in answer to a
  range it cannot use seeks forever.
- `If-Range` that no longer matches falls back to the whole file, because continuing to
  serve ranges from a changed file is how a video plays two halves of two takes.

## Media paths

The same containment discipline as the rest of this port: a path that climbs out is
refused rather than normalised into something plausible, along with null bytes and the
characters Windows will not open. A doubled separator is collapsed — sloppy, not hostile,
and the traversal segments it might hide are still caught.
