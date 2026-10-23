# Play links are Loom's dev-sandbox address, and stay the same

- **Date:** 2026-10-23
- **Type:** feat
- **Scope:** `server`, `web`
- **Breaking:** yes — play links no longer need a sign-in or expire; whoever can reach the sandbox origin can play any activity, as with Loom's dev-sandbox

Playing an activity now lands on Loom's dev-sandbox address, `<sandbox origin>/player.html?module=<product>&ref=<n>&…`, the same link every time, on every server and across restarts. Deployed as Loom deploys it, the sandbox origin is `https://dev-sandbox.<zone>`. Before, each Play signed a new `/preview/activity/<token>/play` link that ran out after 12 hours, and a restart ended every open one.

## Details

- The sandbox origin is the preview origin: `PENGUIN_PREVIEW_ORIGIN` when it is set (set it to `https://dev-sandbox.<zone>` to match Loom's deployment), otherwise the loopback name the App leaves free (`127.0.0.1:<port>` when the App is on `localhost`). A reverse proxy in front of it must pass `/player.html` as well as `/preview/*`; the loopback host guard now lets `/player.html` through.
- On the sandbox origin, `/player.html` is the player page itself, as Loom's dev-sandbox serves it. On the App's own host it sends the visitor to the same address on the sandbox origin; with no sandbox origin at all it serves the page there, sandboxed, with an opaque origin. A module's code never runs with the author's session.
- The link is Loom's: `module`, `ref` and `source` name the ref, then `languageCode`, `startSceneId` and `resolution`. It asks for no sign-in and finds the ref in every project. `project=<id>` is added only when the ref is open in more than one project, which the page otherwise names rather than guessing.
- The page reports its state only to the App origin that opened it, named in the link as `parent=<origin>`. The expiry notice is gone.
- The page's files hang off the activity's play key, `/preview/activity/<project>~<activity>/…`, which also plays on its own at `…/play`. A module run's key names the run (`<project>~<activity>~<run>`): the run's player check plays that run's own build, and only a run that is running or has succeeded. Cleanup leaves a run's folder alone for 12 hours after a link to it was made.
- The test browser plays on the loopback sandbox host. Where there is none (a wildcard bind, or a configured preview origin) its page is served sandboxed.
