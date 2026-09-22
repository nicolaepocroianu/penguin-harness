# The preview serves a module

- **Date:** 2026-09-22
- **Type:** feat
- **Scope:** `server`

`GET .../activities/:activityId/sandbox/payload` returns what the learner runtime fetches:
the built module's declaration, its configuration scoped to a language, this ref's media,
and the scene the preview starts on. `?language=` and `?scene=` choose the last two.

## A module's own URLs are pointed at a route

A definition names its files relative to itself, because in a deployment the module sits at
its own root. In a preview it sits behind a per-activity route, so a URL left alone resolves
against the harness and fetches nothing. Media, shared framework layouts and external
addresses are left as they are — all three are already reachable, and prefixing them breaks
all three.

## A theme the module does not have is refused

Themes differ in the assets they provide. Quietly falling back to another one produces an
activity that plays with the wrong pictures and reports nothing, so the refusal names the
themes the module actually has.

## Only a succeeded build is served

A failed build leaves a half-written workspace behind, and serving from it would give an
author a preview of code that did not compile. The newest **succeeded** module run wins.

This also corrects `sandbox/status`, which reported `hasModule: false` unconditionally and
so always claimed nothing had been built.

## The version token is the draft revision

Media URLs carry it, so a regenerated clip at the same path is fetched again rather than
played from cache. It changes exactly when the draft does, which is the only time a cached
URL would be wrong.

An activity with no configuration for its ref is served an empty one. The module is there
and an author can see that its configuration is not — a different thing from no build.
