/**
 * How a hot push compiles its two entries, the platform and the CLI, into one self-contained ESM
 * file each — the same compile a source checkout's install image goes through, since that image is
 * packed by `deploy.mjs --out`.
 *
 * Self-contained is the point: `bundle: true` with one `external` (below) inlines every package the
 * entry imports statically, the gateway library (`@prismshadow/mmsp`) included. A pushed build
 * lands in a data root's store and runs on whatever program booted it — on a machine, a release's
 * Node and loader — and nothing it imports is looked up in that program's `node_modules`, which
 * belongs to another version: a build pushed onto release 0.2.13, whose `node_modules` holds
 * `@prismshadow/agenthub` 0.4 and no mmsp, runs the mmsp it was compiled with. A dependency that
 * changes changes the bundle's bytes, so the build's hash, its version suffix and the "target
 * already has this build" check all move with it. What is left for run time is an optional package
 * a dependency imports dynamically and guards (the Bedrock client's credential providers) and
 * `playwright-core`; native binaries travel beside the bundle as assets (node-pty, see deploy.mjs).
 *
 * A module of its own so that a test compiles with exactly these options.
 */
import { createRequire } from "node:module";
import { buildGitDefine } from "./build-git-stamp.mjs";
import { ESM_CJS_BANNER } from "./esm-cjs-banner.mjs";

const require = createRequire(import.meta.url);

/**
 * The esbuild options for one entry. The banner is load-bearing: bundled CJS deps reference
 * `require`, `__filename` and `__dirname` inside their own wrapper, and an ESM bundle supplies
 * none of the three — see esm-cjs-banner.mjs.
 */
export function pushBundleOptions(entry, outfile) {
  return {
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "node",
    // The Node that runs it (package.json engines). Without a target esbuild compiles for
    // `esnext`, where it takes standard decorators to be supported and emits them as they
    // were written — and no Node parses those, so the pushed bundle fails to import with
    // "Invalid or unexpected token" and the target keeps the generation it had. The
    // packaged build does not hit this because tsup passes a target of its own.
    target: "node24",
    outfile,
    logLevel: "silent",
    banner: { js: ESM_CJS_BANNER },
    // The one package left to run time, as in packages/desktop/tsup.config.ts. playwright-core
    // finds its browsers.json and injected scripts beside its own files, which a bundle has none
    // of, and its bidi-over-CDP path requires `chromium-bidi`, which it does not ship, so esbuild
    // cannot resolve it. The server only reaches it through a lazy `import()` when an activity
    // wants a browser (browser-session.ts), and resolves it from disk there already
    // (test-browser.ts).
    external: ["playwright-core"],
    alias: {
      "@prismshadow/penguin-core/kernel": require.resolve("@prismshadow/penguin-core/kernel"),
    },
    // The pushed bundle lands under `<root>/hmr/store/`, outside any checkout, so its own
    // revision has to be inlined here or it can never be recovered: `penguin version` from
    // a hot-loaded CLI would otherwise report the bare version it was compiled from. This is
    // the same value the push records as `source`, reaching the target by a second route —
    // in the artifact itself rather than in harness.json.
    define: buildGitDefine(),
  };
}

/** Compiles with `options` (pushBundleOptions, or a variation of them in a test). */
export async function compilePushBundle(options) {
  const esbuild = await import("esbuild");
  await esbuild.build(options);
}
