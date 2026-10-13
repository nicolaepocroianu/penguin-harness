# The activity bench's browser reaches only the played module

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `tooling`, `skills`
- **PR:** [#130](https://github.com/nicolaepocroianu/penguin-harness/pull/130)

The [activity bench](2026-10-13-activity-bench.md) ran each check in a confined Node process, but
the browser the check drove ran unconfined, as the person running the bench: a trial's own tests
could open a `file://` URL in it and read anything that person could — a Claude login, Penguin's
vaults, the other side's trial home — and send it to any host. The browser now starts with no
route anywhere but the played module's own port (a proxy that leads nowhere for everything else,
other loopback ports included; host names that resolve to nothing; no WebRTC around the proxy),
and a check reaches it only through a guard that passes calls on the kinds of object the harness
and a test's page work use, and nothing else, and of those refuses a navigation anywhere but the
played module's origin, a context with its own proxy or recordings, files read from or written to
this disk, raw DevTools sessions, the browser's own HTTP client, tracing and artifacts. A
real-browser test showed each escape failing with the locks — a local file, other hosts, another
loopback port, the cloud metadata address, a link-local IPv6 address — while the placeholder
hidden checks still passed. The recipe surface also refused a symbolic link (or a submodule)
anywhere in a candidate's change.

## Details

- The guard (`scripts/activity-bench/browser-guard.ts`) sat between the check and Playwright's
  browser server on loopback, behind a random path. Its source became part of the scorer's
  fingerprint.
- The skill's limits said what the browser could have read without the locks and what now stops
  it; that a check's own Node process still reaches the network (Node's permission model has no
  network scope), so it can fetch services on loopback and send what it gets anywhere; and kept
  the advice to run the bench under a dedicated OS account with no credentials.
