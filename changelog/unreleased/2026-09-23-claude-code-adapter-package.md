# Claude Code starts when its ACP adapter is not installed

- **Date:** 2026-09-23
- **Type:** fix
- **Scope:** `coding-agents`, `server`

Picking Claude Code without its ACP adapter installed failed every message with "the agent exited before the ACP handshake completed". The fallback ran `npx -y claude-agent-acp`, a package that does not exist on npm, so npx quit before the agent could answer. It now runs `@agentclientprotocol/claude-agent-acp`, the package the adapter is published under.

## Details

- Codex's fallback and install hint move to `@agentclientprotocol/codex-acp`. The old `@zed-industries/codex-acp` stopped at 0.16.
- A Claude Code or Codex agent already saved with an old package name is corrected when the server loads it, so there is nothing to re-save.
- The install hint on the Claude Code card names the published package.
