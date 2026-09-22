# Models: coding agents under Local CLI, and chats with them as ordinary Sessions

- **Date:** 2026-09-23
- **Type:** feature
- **Scope:** `server`, `web`

The Models page now opens with a choice between **Local CLI** and **API providers**. API providers is the page as it was. Local CLI lists the coding agents on the server machine as model sources: one card per installed agent with its logo, name and maker, version and sign-in state, and the model it will use. Selecting a card opens its Model and Reasoning effort, both read from the agent itself ("Synced from CLI") and remembered for it, with a button to start a chat. Agents that are not installed wait in a folded list with a link to install them; admins can add a custom agent, rescan, or remove a saved one. `?view=local` links straight to it.

## Chats

- The chat model dropdowns take coding agents from the model list the server returns (`codingAgentModels`) instead of building them in the browser, so the new-chat dropdown, a Session's model label and the `/model` switch all see the same rows, with the agent's vendor logo (Anthropic, OpenAI, Google) or its own letter tile, and without the "no key" mark.
- Sending the first message with a coding agent picked now creates an ordinary Session: it opens at `/chat/<id>`, sits in the sidebar under the Agent picked beside the composer, and uses the chat view, approvals and Trace every Session has. A message with no text is refused, since the agent is sent text.

## Settings remembered per agent

- Besides the model, other settings an agent offers can be remembered for it (`PUT /api/coding-agents/agents/:agentId/options`, admin only); the Reasoning effort select uses it. They are applied to the agent's new sessions after the model.

## The coding-agents screen

- Its agent management moved to Models → Local CLI, and it left the main navigation. It remains as **Coding agent runs**, where the sessions activity stages start are followed; activity run links and the Quick Switcher's run entries still open it. The Quick Switcher's agent entries open Models → Local CLI.
