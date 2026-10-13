# The activity bench's browser reaches only the played module

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `tooling`, `skills`
- **PR:** pending

The [activity bench](2026-10-13-activity-bench.md) ran each check in a confined Node process, but
the browser the check drove ran unconfined, as the person running the bench: a trial's own tests
could open a `file://` URL in it and read anything that person could — a Claude login, Penguin's
vaults, the other side's trial home — and send it to any host. The browser now starts with no
route off loopback (a proxy that leads nowhere for every other host, host names that resolve to
nothing, no WebRTC around the proxy), and a check reaches it only through a guard that refuses a
navigation to anything but http(s) on loopback, a context with its own proxy or recordings, files
handed to the page from this disk, raw DevTools sessions, the browser's own HTTP client, tracing,
artifacts and launching browsers. A real-browser test showed each escape working without the
locks and failing with them, while the placeholder hidden checks still passed. The recipe surface
also refused a symbolic link (or a submodule) anywhere in a candidate's change.

## Details

- The guard (`scripts/activity-bench/browser-guard.ts`) sat between the check and Playwright's
  browser server on loopback, behind a random path, and passed every other call on unchanged. Its
  source became part of the scorer's fingerprint.
- The skill's limits said what the browser could have read without the locks and what now stops
  it, and kept the advice to run the bench under a dedicated OS account with no credentials.
