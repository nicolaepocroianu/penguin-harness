# Plugins link to the WAF Harness repository

- **Date:** 2026-10-24
- **Type:** docs
- **Scope:** `plugins`, `server`, `web`
- **Breaking:** no

The GitHub fork was renamed to `nicolaepocroianu/waf-harness`, and plugins, packages and the built-in plugin index now link there instead of `Prism-Shadow/penguin-harness`. Plugin documentation links that went to penguin.ooo open the matching page under `packages/docs/content/` on GitHub, since WAF Harness hosts no docs site.

- Every plugin's and package's `repository.url`, the built-in plugin index, and the example prompts in the plugin import dialog point to the fork.
- The `wafh-support` skill reads the docs in `packages/docs/content/` and clones its reference checkout from the fork (version `2026.10.23.1`).
- Links to the upstream benchmark repository and the Penguin Go provider are unchanged.
