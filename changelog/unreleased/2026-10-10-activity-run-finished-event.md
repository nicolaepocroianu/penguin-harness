# The activity list refreshes when a run finishes, without polling

- **Date:** 2026-10-10
- **Type:** feat
- **Scope:** `server`, `web`

The server now publishes `activity_run_finished` on the user event stream (`GET /api/events`)
of a project's owner and members whenever an activity's generation run ends. The event carries
the project, the activity, the run and how it ended: succeeded, failed, conflict, cancelled or
interrupted.

The activities home page refreshes its cards when it hears one, instead of reading every
activity's summary again every 5 seconds while a card says a run is in flight. Runs that finish
together share one refresh. When the event stream reconnects after losing events it cannot
replay (`resync_required`), the list refreshes too, since a finish may have been lost. The page still refreshes when a run it has no row for starts, and
when the user comes back to the list from an activity.

Publishing a server event to a project's owner and members is now one shared helper,
`publishToProjectUsers`, used by sessions, company mode and activity runs.
