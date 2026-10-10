# Sidebar counts and "More" leave activity runs out

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `server`, `web`

The sidebar's session totals and its "More" row counted an activity's generation runs as
conversations, even though the sidebar shows runs only in their own Activity runs folder. A
project with many runs offered "More" rows that loaded nothing new, and each page of ten could
come back with fewer conversations than it promised.

The session list takes a new `excludeActivityRuns=1` flag. With it, runs leave the page, the
`counts=1` totals and the per-Workspace tallies together. On the first counted page (`offset`
0), the response also carries `activityRuns`: the agent's newest runs that are not archived,
up to 50, newest first. The sidebar asks for this on every fetch. It keeps those runs with its
rows, so the Activity runs folder and the notification when a run finishes still find them, and
a run never changes a total. The web no longer filters run Workspaces out of the tallies itself.
