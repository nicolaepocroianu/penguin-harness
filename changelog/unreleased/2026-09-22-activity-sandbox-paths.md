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

## The endpoints

`GET .../sandbox/status` reports the preview state, and `GET .../sandbox/media/*` serves one
file from the draft with range handling. The media route is a wildcard because a media path
is nested — `images/en-US/cat.png` — and the path is validated by shape and then by where it
lands, never trusted.

A partial response reads exactly the planned window out of the file. Reading the whole file
and slicing would put a multi-megabyte video in memory to answer a request for ten
kilobytes of it.

## Two more kernel rules, found by the generator

- `@Use()` must name an **interface**, not a component. A sandbox that was only a component
  is rejected: the interface is declared with `Interface<…>()` and the component
  `implements` it.
- A response carrying bytes needs `Opaque<"Uint8Array", Uint8Array>`, since the contract is
  compared by name across the push boundary rather than expanded structurally.
