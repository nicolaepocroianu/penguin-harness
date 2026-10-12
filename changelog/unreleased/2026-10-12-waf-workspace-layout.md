# One layout module for the WAF checkout and module repositories

- **Date:** 2026-10-12
- **Type:** refactor
- **Scope:** `server`
- **PR:** [#110](https://github.com/nicolaepocroianu/penguin-harness/pull/110)

The folder grammar of the WAF checkout and of the module repositories in it moved into `activities/waf-layout.ts`. `WafLayout` (a checkout at its root) and `ModuleLayout` (a module repository at its root) became the only places that join these paths, strip a manifest's `media/` prefix, name module documents and check that a folder chosen by stored data stays inside `modules/` or the media repository. Every path resolves to the string it resolved to before.

## Details

- `WafLayout` places the framework, navbar, media and activity-data repositories (`repo(id)`), a product module (`moduleDir`, which returns null, and `module`, which refuses with 400 `module_folder_invalid`, for a folder that would leave `modules/`), a manifest reference's file in the media repository (`mediaFile`), and lists the products under the modules (`products`). `WafLayout.containing` names the checkout a module folder sits in. `findWafRoot` moved here from `waf-module.ts`.
- `ModuleLayout` places a product's folder, its `spec/` and `refs/`, a ref's folder and its `spec/`, and the configuration, assessment and definition documents, for a checkout module and a module run's `module/` alike. The relative names a module uses for itself (`refSpecPath`, `moduleDocumentPath`) sit beside it.
- The media naming (`refMediaFolder`, `mediaSparsePath`, `mediaRepoPath`, `mediaReference`) and `moduleShortName` moved here from `ref-media.ts` and `deploy-git.ts`; `WAF_REPO_PATHS` moved here from `waf-workspace.ts`, and `deployClonePaths` was removed in its favour.
- The path helpers `ref-files.ts` and `loom-read.ts` each kept for the same tree (`productDir`, `refDir`, `refSpecDir`, `refFolderName`, `refDirName`, `parseRefDirName`, `loomProductPaths`, `loomRefPaths`) were merged into the layout, and `discoverLoomProducts`, which nothing called, was deleted. `readProductOwner` and `writeProductFiles` take the product's `spec/` folder.
- Template strings building these paths in `service.ts`, `sandbox-service.ts`, `deploy-service.ts`, `deploy-context.ts`, `waf-workspace.ts`, `waf-module.ts`, `generation.ts`, `state-machine-configuration.ts`, `languages.ts`, `media.ts`, `book-configuration.ts`, `sandbox-ref-assets.ts` and `deploy-preflight.ts` were routed through it.
- `test/waf-layout.test.ts` pins every path through the layout's interface, including the refusal of `..`, absolute and empty module folders and of media references that leave the media repository.
