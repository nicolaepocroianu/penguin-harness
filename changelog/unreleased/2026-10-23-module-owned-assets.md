# The player serves the files a module packages itself

- **Date:** 2026-10-23
- **Type:** fix
- **Scope:** `server`

The module-file route served only code, styles, images and fonts, so a module's own `.riv`, `.wasm`, `.gltf`, `.glb`, `.bin` and `.mp3` files were refused with a 400: Rive and three.js prototypes could not load their engines or models, and modules with narration under `res/audio` played silent. They are now served from the same roots as before (build output, `res`, the module), with the types Loom's dev-sandbox sends: `application/wasm`, `model/gltf+json`, `model/gltf-binary`, `audio/mpeg`, and `application/octet-stream` for `.riv` and `.bin`. Path containment and the `{{MEDIA}}` route did not change.
