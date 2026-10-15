# Activity runs' agents no longer get the admin API token or the penguin CLI

- **Date:** 2026-10-15
- **Type:** fix
- **Scope:** `server`, `core`, `web`, `docs`
- **PR:** [#146](https://github.com/nicolaepocroianu/penguin-harness/pull/146)

A Session whose Workspace is an activity run's folder (the run's own Session and its subagents alike) stopped receiving `PENGUIN_API_URL` and `PENGUIN_API_TOKEN` in its commands' environment, and stopped finding the server's `penguin` shim at the front of its PATH. Every other Session the server runs kept both. The run's agent still gets its Session variables (`PENGUIN_PROJECT_ID`, `PENGUIN_AGENT_ID`, `PENGUIN_SESSION_ID`), whether or not **Confine activity agents** is on.

## Details

- Core's `CreateAgentOptions.pathPrepend` became a policy evaluated with each Session's coordinates (`ControlEnvContext`), the same ones `controlEnv` receives, for the Session's commands and its hook scripts alike. A getter that takes no argument still fits the new type.
- The server's `SessionEnv.pathPrepend` took the Session's coordinates, and both it and `controlEnv` left the harness's means of reach out for a Session working under `<root>/activity-runs/`.
- Coding agents were checked and were not changed: their environment is an allow-list that never carried the token, the address or the shim.
- The **Confine activity agents** explanation in System settings > WAF workspace said that only writing is confined: a run's agent can still read every file the server can, the data folder's secrets included, and reach the network. The status line under the switch said what "confined" covers.
- The CLI, Configuration and Server API docs said that activity-run Sessions get neither the API address nor the token, and no launcher on their PATH.
