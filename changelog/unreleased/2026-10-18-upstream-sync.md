# Penguin Harness caught up with the parent project's releases 0.2.14 to 0.2.16

- **Date:** 2026-10-18
- **Type:** feat
- **Scope:** `core`, `server`, `web`, `ui`, `cli`, `desktop`, `docs`, `landing`, `plugins`, `ci`
- **PR:** pending

The fork took in all 257 changes the parent project (Prism-Shadow/penguin-harness) made after 2026-09-18, through its releases 0.2.14, 0.2.15 and 0.2.16, and kept everything built here: activities and the Activity Studio, coding agents, the session sandbox, module releases and the bench. The app stays English only, as before.

## Details

- New from the parent project: machines that run sessions elsewhere, the Agent API and its AMSP stream, Agent Workbench apps, the built-in browser in the desktop dock and the Chrome extension, A2UI blocks in replies, the plugin market with import and export, Benchmarks as packages with five built-in suites and GDPevo, the RSI toolkits, switching the model inside a Session, session archiving, the Frost theme with custom backgrounds, the command palette and keyboard shortcuts, the Markdown reader, and a refreshed model catalog on the MMSP gateway.
- The sandbox gained named presets, the Linux Landlock backend and the WSL backend, and now also confines hook scripts, stdio MCP servers and the file tools. The MXC backend is gone. DSH is still loaded on every server. On Windows it refuses to confine commands under Git bash, so it needs `PENGUIN_SHELL=pwsh` there.
- GitHub Copilot and ChatGPT subscriptions still run through AgentHub, behind the same model interface as every other model.
- Database migrations from the parent project run after this fork's own: an existing database at version 25 moves to 35. A database created by the parent project's releases is not supported.
- The parent project's Chinese translations, language switches and `*_zh` manifest fields were left out. Plugin manifests moved from `plugin.json` to each plugin's `package.json`, `use-codex` and `waf-authoring` included.
- Errors with structured facts carry them under `error.details` (was `error.detail`).
