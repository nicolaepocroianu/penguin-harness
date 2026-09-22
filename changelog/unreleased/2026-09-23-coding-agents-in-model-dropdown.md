# Start a coding agent from the new-chat model dropdown

- **Date:** 2026-09-23
- **Type:** feature
- **Scope:** `web`

Starting an external coding agent no longer goes through a form that asks for a folder. The new-chat model dropdown lists the coding agents the server has saved or detected as runnable, in their own group after the models, and, once a probe has seen them, each model an agent advertised ("Codex CLI · gpt-5"). Picking one and sending the first message starts that agent's session with the message; the conversation then continues on the coding-agents screen, which shows its transcript, tool calls and permission asks.

## Details

- The Workspace picker under the composer applies as it does for a model and stays optional: empty is a temporary workspace.
- The Penguin Agent picker is hidden while a coding agent is picked, since it does not apply.
- A coding agent takes text; images in the first message are not sent, and a message with no text is refused with a note.
- Coding agents are never hidden behind the dropdown's "models without a key" row: their CLIs sign in on the server machine.
- New session on a coding-agent card now opens a new chat with that agent already picked, replacing the separate start-session dialog.
