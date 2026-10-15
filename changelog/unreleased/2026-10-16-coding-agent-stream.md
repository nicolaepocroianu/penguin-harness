# Coding-agent sessions keep streaming after 30 idle minutes

- **Date:** 2026-10-16
- **Type:** fix
- **Scope:** `server`
- **PR:** [#151](https://github.com/nicolaepocroianu/penguin-harness/pull/151)

A coding-agent session opened through `/api/coding-agents/sessions` stopped streaming live once its channel had gone 30 minutes with no subscriber: the hub reclaimed the channel, the next stream got a new one, and the session's events kept going to the reclaimed one until the session was disposed or the server restarted. The bridge from the agent's events to the session's channel now looks the channel up on every publish, as Penguin Sessions already did. The hub's idle reclaim was not changed.
