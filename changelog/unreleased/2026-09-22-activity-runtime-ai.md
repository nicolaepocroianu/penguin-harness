# Who may call the runtime AI endpoint from inside a preview

- **Date:** 2026-09-22
- **Type:** feat
- **Scope:** `server`

Some WAF activities ask an AI service something while a learner is using them. Loom serves
that from its sandbox by spawning a child process per request, one at a time. Penguin has
agent Sessions for exactly that, so the execution is not what needs porting — the admission
rules are.

They are the interesting half regardless. This endpoint is reachable from inside a preview,
which means it is reachable from module code an agent generated. What it refuses is a
security question, not plumbing.

## The order the checks run in

Deliberate, and the tests pin it.

`not_declared` comes **before** `busy`. An activity that never declared the capability is
not waiting for a turn — it is asking for something it has no business asking for, and
telling it to try again later would be a lie that hides a generated module calling an
endpoint nobody granted it.

A bad prompt is reported before busyness too, so a malformed call is never mistaken for a
queue.

`not_declared` answers **403**, not 404: the endpoint exists, this activity may not use it.

## The declaration

Read off the saved specification, not configured per preview. A capability the preview
grants and production does not is a preview that lies. Only an explicit `true` counts —
a string `"yes"` does not.
