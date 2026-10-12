# One answer to which module a preview and a deploy use, and one module builder

- **Date:** 2026-10-12
- **Type:** refactor
- **Scope:** `server`
- **PR:** [#114](https://github.com/nicolaepocroianu/penguin-harness/pull/114)

The choice of module for a ref and the module documents in effect for it moved into one module source (`activities/module-source.ts`), which the sandbox, deploys and versions ask; every module build and stylesheet compile moved behind one module builder (`activities/module-builder.ts`), which the sandbox and a deploy's prepare stage share. Preview stylesheets are now compiled with sass 1.54.0, the version a deploy compiles them with, instead of the server's own sass.

## Details

- `ActivityModuleSource` answers, for a ref and a purpose: the build it uses (`build`; a preview plays the pinned build while it is still a succeeded build, else the newest; a deploy and a deploy version take the newest), the module itself (`resolve`; for a preview the build, else the product's checkout folder when it holds a module, or a play link's running or succeeded run; for a deploy the newest build when it holds a `package.json`, its documents falling back on the checkout folder), and a module document in effect (`document`; the author's edit, else the module's own file in each root in turn, a ref's assessment falling back on the canonical ref's).
- `ModuleBuilder` (`DefaultModuleBuilder`) runs a run workspace's own build, a checkout module's build into Penguin's output, the player bundle, and `compileStyle`. The sandbox builds through it, and `prepare_deploy` compiles `res/style.scss` through it in place of `npx --yes -p sass@1.54.0 sass …`; its log line reads `$ sass@1.54.0 res/style.scss res/style.css --no-source-map`.
- Stylesheets, preview and deploy alike, compile with the sass 1.54.0 command line (`sass <from> <to> --no-source-map`). It is installed with npm into `<PENGUIN_HOME>/tools/sass-1.54.0` on first use, once for concurrent callers, with the requesting module's `.npmrc` as npm's project config when it has one (so the install reaches the registry `npx` in the module did; the copy is removed before the install is kept) and npm's user config otherwise, and run from there with the server's Node afterwards without asking a registry. The preview's compile no longer adds the module's `node_modules` as a load path, as a deploy's never did.
- A checkout module's SCSS stylesheet is compiled into Penguin's output before its webpack build runs, instead of inside it.
- The sandbox, deploy and version services take the module source and the builder as kernel dependencies; sandbox tests wire stand-ins for them instead of replacing the service's private builders and its checkout lookup.
- `test/activity-module-source.test.ts` pins both purposes' choices and the document precedence; `test/activity-module-builder.test.ts` covers the install-once Sass and its compile.
