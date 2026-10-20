# A source checkout packs its install image again

- **Date:** 2026-10-20
- **Type:** fix
- **Scope:** `scripts`, `ci`
- **PR:** pending

Since the upstream 0.2.14–0.2.16 merge, `pnpm --dir packages/desktop run image` (and so the CI `runtime` job on every platform) stopped with `Could not resolve "chromium-bidi/lib/cjs/bidiMapper/BidiMapper"`. The hot push and the install image share one esbuild compile that inlines every package, and it reached `playwright-core`, whose bidi-over-CDP code requires a `chromium-bidi` it does not ship.

## Details

- The push and image compile now leaves `playwright-core` to run time, as the desktop bundle already did (`packages/desktop/tsup.config.ts`). The server loads it only through a lazy import when an activity wants a browser, and already resolved it from disk for the test browser.
- A test compiles that lazy import with the push's own options and checks the bundle builds and imports `playwright-core` at run time.
