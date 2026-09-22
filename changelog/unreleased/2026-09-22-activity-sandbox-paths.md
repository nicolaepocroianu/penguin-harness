# Where the sandbox reads, and what it says about a preview

- **Date:** 2026-09-22
- **Type:** feat
- **Scope:** `server`

Path resolution for the dev sandbox, in one place. Every one of these is a containment
boundary: the sandbox serves files chosen by a URL, so "which directory may this request
reach" has to be one answer rather than a `path.join` at each call site.

Media resolves against the **draft's own** directory, not an assembly run's copy. That is
the point of the live origin — a newly saved asset appears without rebuilding anything.

## Containment, twice

`previewMediaPath` rejects a path by its shape. `withinRoot` checks the result after
joining. A shape nobody anticipated still cannot reach outside, and a sibling root whose
name merely shares the prefix — `/srv/media-private` against `/srv/media` — is not inside
it.

A path that climbs and comes back lands inside, so there is nothing to refuse; the test
says so, because refusing it would be a plausible-looking mistake.

## The reply

Every preview state carries a message an author can act on, and a test asserts none can
reach the interface unexplained.

A failed build's output travels with the reply even when a preview from an earlier build is
still on disk. Reporting `ready` because stale output happens to exist is the quiet success
this port is not allowed to produce.
