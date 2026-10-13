# Core and server tests caught up with the plugin library and the WAF test checkout

- **Date:** 2026-10-13
- **Type:** process
- **Scope:** `core`, `server`, `plugins`
- **PR:** [#PR](https://github.com/nicolaepocroianu/penguin-harness/pull/PR)

Six tests that had failed on `main` passed again, each brought back in line with a change that
had already shipped: the `waf-authoring` plugin, the English-only plugin library, and the WAF
checkout every server test app records.

## Details

- Core's plugin loader test compared the loaded plugins with every `plugins/` directory carrying
  a `plugin.json` instead of a fixed count of 14, and exempted `waf-authoring`, whose skills are
  contracts staged into activity runs, from the "## Before you start" section convention.
- `plugins/README.md` and the root `README.md` listed `waf-authoring` under Software Development,
  and the plugins README named `use-codex` and `waf-authoring` among the `preinstall: false`
  plugins.
- The server's plugin library tests expected no Chinese category titles, plugin descriptions or
  skill short descriptions, matching the library since its Chinese translations were removed.
- The admin settings tests started their server without a WAF checkout, so the "no rows" case read
  an empty `server_settings` table.
