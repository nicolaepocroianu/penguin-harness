# Building a module on demand, once

- **Date:** 2026-09-22
- **Type:** feat
- **Scope:** `server`

Loom rebuilds inside a watch-mode dev server: a request arrives, freshness is checked, and
the module is rebuilt if its sources moved. This does the same without the second server.

The interesting part is not the spawn. It is what happens when four requests for the same
preview arrive while a build is already running — so the build is injected, and the
coalescing, the freshness decision and the failure reporting are ordinary code with tests.

## Two bugs its own tests found

Both in the coalescing, which is the one thing this class exists to do.

**The in-flight entry has to be registered synchronously.** The freshness scan is async, so
checking the map and then awaiting leaves a window where every concurrent caller sees an
empty map and starts its own build. Four requests started four builds; the test hung
waiting for three nobody had asked for.

**The entry has to be cleared before the caller is resolved**, not in a trailing `finally`.
Cleanup that runs afterwards means the next request arrives while the entry is still there
and joins a promise that has already settled — which reports a skip as a join, and reports
a failed build as one somebody else was already running.

## What a caller is told

Three different facts, kept separate because only one of them is ever true: it built, it
joined a build already in progress, or nothing needed building. "Your build finished" and
"someone else's build finished and it covered you" are different claims.

A build that could not start at all — webpack missing, for instance — is a failed build
with a reason, not an exception thrown at whoever happened to request the preview. It also
leaves no build timestamp, so the module stays stale and the next request tries again
rather than serving something that was never built.
