# Books in the waf-modules monorepo open, build and play with no hand setup

- **Date:** 2026-10-20
- **Type:** feat
- **Scope:** `server`, `web`
- **PR:** [#165](https://github.com/nicolaepocroianu/penguin-harness/pull/165)

Penguin can now open product modules from a monorepo's modules folder, such as `waf-modules/modules`, beside the WAF checkout's own `modules/`, as Loom reads its two module roots. An admin names the folder in Settings → WAF workspace → Monorepo modules, or the server is started with `WAF_MODULES_DIR`. The checkout still provides the framework, media, activity data and navigation bar.

## Details

- A module folder that exists in the monorepo is opened from there; a new module is still made in the checkout's `modules/`. Module folder names are still checked to stay inside a modules root.
- A monorepo's module is never cloned or made a repository, and deploying one is refused (`deploy_monorepo_module`): it shares the monorepo's repository, so git there would act on the whole monorepo. Deploying from the monorepo needs its own design.
- The preview build finds packages in every `node_modules` from the module up to its npm workspace's root, where the monorepo installs them, then in the framework's. It finds the framework from the WAF checkout, not from the module's parent folder, runs the TypeScript compiler that TypeScript's own `package.json` names (TypeScript 7 included), and passes the media folder as `WAF_MEDIA_DIR`, as Loom does.
- Module, product and ref folders that are links (symlinks, or junctions on Windows) are listed like folders.
- When a module's `.nvmrc` or `engines.node` asks for another Node than the server runs, the build log says so on its first line. Penguin still builds with the server's Node and installs none.
- Play links read Loom's dev-sandbox query with Loom's rules: `languageCode` (a listed code, else English), `startSceneId`, `resolution` (`<width>x<height>`, else ignored; the activity plays at that size), `ref` (a non-negative whole number, else 400) and `source` (`monorepo` or `legacy`). The older `language` and `scene` still work, and the Studio's links now use Loom's names.
- `GET /api/projects/<project>/activities/sandbox/play?module=<product>&ref=<n>[&source=…]` plays the ref a Loom link names: 404 `play_ref_not_open` when the project has not opened it, 404 `play_source_mismatch` when its module is in the other root. On a link to one activity, a `module`, `ref` or `source` that names another one is refused (400 `play_link_mismatch`); the signed link always decides what plays.
- Loom's own address works on Penguin's origin: `/player.html?module=<product>&ref=<n>&languageCode=…&startSceneId=…&resolution=…&source=…`. It needs the App's sign-in (a visitor without one is sent to sign in), finds the ref in a project the visitor can see, and sends them to its signed play link on the preview origin; no module code is served on the App's origin. A ref open in several of the visitor's projects is not guessed: the page names them, and `project=<id>` picks one. An unknown module or a bad ref gets Loom's player's own message.
