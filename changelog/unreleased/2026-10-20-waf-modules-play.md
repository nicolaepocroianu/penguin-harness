# Books in the waf-modules monorepo open, build and play with no hand setup

- **Date:** 2026-10-20
- **Type:** feat
- **Scope:** `server`, `web`
- **PR:** pending

Penguin can now open product modules from a monorepo's modules folder, such as `waf-modules/modules`, beside the WAF checkout's own `modules/`, as Loom reads its two module roots. An admin names the folder in Settings → WAF workspace → Monorepo modules, or the server is started with `WAF_MODULES_DIR`. The checkout still provides the framework, media, activity data and navigation bar.

## Details

- A module folder that exists in the monorepo is opened from there; a new module is still made in the checkout's `modules/`. Module folder names are still checked to stay inside a modules root.
- A monorepo's module is never cloned or made a repository, and deploying one is refused (`deploy_monorepo_module`): it shares the monorepo's repository, so git there would act on the whole monorepo. Deploying from the monorepo needs its own design.
- The preview build finds packages in every `node_modules` from the module up to its npm workspace's root, where the monorepo installs them, then in the framework's. It finds the framework from the WAF checkout, not from the module's parent folder, runs the TypeScript compiler that TypeScript's own `package.json` names (TypeScript 7 included), and passes the media folder as `WAF_MEDIA_DIR`, as Loom does.
- Module, product and ref folders that are links (symlinks, or junctions on Windows) are listed like folders.
- When a module's `.nvmrc` or `engines.node` asks for another Node than the server runs, the build log says so on its first line. Penguin still builds with the server's Node and installs none.
