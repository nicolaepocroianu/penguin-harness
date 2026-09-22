# Models page: filter by API keys or subscriptions, and disconnect a signed-in subscription

- **Date:** 2026-09-23
- **Type:** feature
- **Scope:** `web`

The Models page gained All / API keys / Subscriptions tabs. Subscriptions are the groups signed in through a device flow (ChatGPT/Codex, GitHub Copilot); everything else, custom and user-defined groups included, counts as API-key billing. An empty tab says there are no models of that kind rather than reporting an empty search.

A subscription that is already signed in now offers Disconnect in its group header instead of Connect again. Copilot gets its own disconnect confirmation, which notes that environment credentials still apply. ChatGPT no longer offers a pasted-key action, since it only takes its sign-in.
