# Building a module on demand

- **Date:** 2026-09-22
- **Type:** feat
- **Scope:** `server`

`SandboxBuilder` already decided *whether* to build and made sure only one build ran at a
time. It was not connected to anything. Now it is: `POST .../activities/:activityId/sandbox/build`
builds the module if its sources moved, or rebuilds regardless with `{"force": true}` —
what a Play button does, because an author pressing it after a build they believe failed is
asking for a build, not a freshness opinion.

The module's **own** toolchain runs it. The scaffold ships `webpack.config.cjs` and a
`build` script, and a preview built by anything else would be a preview of something the
deployment will never produce.

## Only the canonical ref may build

A build writes into the shared module, and only the canonical ref owns it. A non-canonical
ref asking to build is refused and told which ref to build from — the same rule the
assembly stage already enforces.

## Killing a build actually kills it

On Windows `npm` is a shell wrapper, so signalling the child kills the wrapper and leaves
webpack running: the process keeps the workspace, the close event waits for the real build,
and a timeout that waits for it is not a timeout. The process **tree** is stopped instead.

Found by the timeout test, which took the full sixty seconds it was meant to cut short and
then failed to delete its own directory.

## A failed build says so

A build that could not start is a failed build with a reason, not an exception thrown at
whoever happened to request the preview. Its output is kept — from the **end**, because
that is where the error is, and truncating from the end throws away the only part anyone
reads. `sandbox/status` now carries the last build's log, so a failure is visible rather
than showing as a preview that simply never appears.
