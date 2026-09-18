# Clear Copilot authorization errors

- **Date:** 2026-09-19
- **Type:** fix
- **Scope:** `server`, `web`

[中文版](2026-09-19-copilot-oauth-errors.zh.md)

Separated expired device codes from expiring credentials, denied authorization, unsupported tokens, and invalid app settings in the Copilot connection flow.

## Details

- Added actionable messages for unsupported token responses without exposing credentials.
- Accepted case-insensitive bearer token types and retained rejection of refresh credentials.
