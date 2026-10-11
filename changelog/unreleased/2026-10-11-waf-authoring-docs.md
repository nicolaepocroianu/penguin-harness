# The Skills page lists the `waf-authoring` plugin

- **Date:** 2026-10-11
- **Type:** process
- **Scope:** `docs`
- **PR:** [#105](https://github.com/nicolaepocroianu/penguin-harness/pull/105)

The built-in library table on the Skills & Plugins page now has a row for `waf-authoring`, under
Software Development. It says what the plugin is for and that it is not preinstalled.

## Details

- The docs sync test checks that the Skills page names every plugin in the library. It failed on
  `main` because `waf-authoring` was missing, and it passes again.
