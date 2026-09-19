# Connect ChatGPT from the Codex plugin

- **Date:** 2026-09-19
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `skills`

[中文版](2026-09-19-codex-connect.zh.md)

Added **Connect ChatGPT** to the Use Codex plugin card. Project owners could sign in through a device-code dialog, install the Codex skill and configure the selected agent's MCP server together.

## Details

- Added connection status, account disconnection and a shortcut to a new chat with the Codex skill selected.
- Kept credentials project-scoped through the existing Codex ACP bridge. Delegated tasks retained workspace-write access and on-request human approvals.
- Preserved existing skills and unrelated MCP entries, and reported conflicting custom Codex configurations without replacing them.
- Added English and Chinese connection controls and updated the plugin's setup instructions.
