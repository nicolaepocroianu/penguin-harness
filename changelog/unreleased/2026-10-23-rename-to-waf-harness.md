# The product is WAF Harness, with a new logo

- **Date:** 2026-10-23
- **Type:** refactor
- **Scope:** `core`, `server`, `web`, `cli`, `desktop`
- **Breaking:** yes — the data folder, environment variables, CLI command, package names and desktop app identity all changed, with no migration

The fork was renamed from PenguinHarness to WAF Harness throughout, and stopped taking upstream changes. The app, installers, docs, packages, plugins and code identifiers carry the new name, and every logo and icon became the constellation mark: five coloured points joined into a W on a dark rounded tile. A NOTICE file credits PenguinHarness, from which the product is derived, under its Apache 2.0 licence.

## Names

- Display name `WAF Harness`; CLI `wafh`; environment variables `WAFH_*` (`WAFH_HOME`, `WAFH_LANG`, …); data folder `~/.waf-harness` (`~/.waf-harness/data`, `~/.waf-harness/dev-data`).
- Packages `@waterford/waf-harness-<name>` (was `@prismshadow/penguin-<name>`; `amsp` became `@waterford/waf-harness-amsp`); plugins `@waf-harness/<name>` (was `@penguinharness/<name>`), whose package field is `wafh` and keyword `wafh-plugin`.
- Desktop app ID `com.waterford.wafharness` (dev `com.waterford.wafharness.dev`), product name `WAF Harness`, Linux executable `waf-harness`, installer files `wafh-desktop-<os>-<arch>`.
- The bookkeeping file written into module repositories is `wafh.json` (was `penguin.json`). Agent API keys start with `wafh_`, and the list shows the first 13 characters (the prefix and 8 more).
- The `penguin-support` plugin and skill became `wafh-support`; the agent-development skills became `wafh-config`, `wafh-orchestration`, `wafh-plugin` and `wafh-sdk`.
- User-Agent tokens read `WAF-Harness`, including the Copilot and experimental OpenAI transport headers in the `agenthub` patch. The `originator` value that transport sends kept its old value.

## Kept as they were

- Links to upstream on GitHub (pull requests, issues, the benchmark repository), the penguin.ooo hosts, the Penguin Go gateway, the Docker image and the download mirror, which all name upstream's own services.
- Released changelog folders, existing changelog entries and upstream's blog posts.
- The frozen toggles-generation prompt fixture. The default prompt names the product, so the kernel advanced to `2026-10-23`.

## Logo

- `packages/desktop/scripts/render-icon.mjs` renders every PNG from `packages/web/public/wafh-logo.svg`, now including the browser extension's `icons/wafh-128.png`. The macOS menu bar image is the tile solid with the W cut out of it.

## Compatibility

Nothing is migrated. A WAF Harness install starts with an empty `~/.waf-harness`: re-create projects there, or set `WAFH_HOME` to an existing data root. Rename any `PENGUIN_*` environment variables to `WAFH_*`, and call `wafh` instead of `penguin`. The desktop app installs as a new application beside an old PenguinHarness one, and does not remove an old `penguin` command from `PATH`. Reinstall the browser extension, re-create Agent API keys, and re-pair messaging bots under the new name.
