# A Session rebuilt after a restart keeps its id

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `core`, `server`
- **PR:** [#PENDING](https://github.com/nicolaepocroianu/penguin-harness/pull/PENDING)

A Session that was created but never run has no Trace, so after a restart (or once its runtime was
released) the server rebuilt it. The rebuild minted a new id and renamed the Session row and its
activity runs, but a bot binding, a schedule, a company desk, the Session's attachments and anything
else naming the old id lost it: a bot answered `session_not_found`, a schedule was marked
`session_missing`, and company mode opened a second desk. The rebuilt Session now keeps its id, so
everything naming it still finds it.

## Details

- core: `CreateSessionOptions.sessionId` rebuilds a Session that has no Trace under its existing
  id. It must have the shape `createSession` gives ids, and an id that already has a Trace is
  refused, since that Session is resumed with `resumeSession`. The Sessions and Traces page
  describes it.
- server: the Session loader rebuilds a Trace-less Session with its row's id. The id swap after a
  rebuild was removed, with the Session-index rename, the activity-run rename and the
  `session_created` announcement it sent.

## Compatibility

Sessions rebuilt before this change keep the new id they were given, and whatever still names their
old id stays stale: the old-to-new mapping was never recorded. To recover, bind the bot to the
Session again and recreate the schedule against it; company mode's reconcile already opens a fresh
desk.
