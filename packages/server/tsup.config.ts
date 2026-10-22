import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Options } from "tsup";
import { FAR_SIDE_SCRIPTS } from "../../scripts/far-side-scripts.mjs";
import { LOCAL_AUDIO_ASSETS } from "../../scripts/local-audio-assets.mjs";
import { MEDIA_PLACEHOLDER_ASSETS } from "../../scripts/media-placeholder-assets.mjs";

// Explicitly name entries to preserve subpath exports: "./api", "./lock",
// "./initial-password" and "./reset-admin-password" (lock, initial-password and
// reset-admin-password are side-effect-free for CLI pre-checks and the offline
// admin-password rescue); "./secret-file" is the shared symlink-safe writer;
// "./hmr/manifest" is the host-less harness.json reader the CLI's thin loader
// resolves the current cli bundle through, and "./version-report" is the shared
// assembler `penguin version` and GET /api/version both render (core plus that
// same reader — no server). There is deliberately no
// "./platform" subpath: src/hmr/entry.ts (this package's platform artifact
// compile target — see its own module doc) is compiled straight from source by
// esbuild in scripts/deploy.mjs, never through this package's published dist,
// so it has no reason to be a tsup entry or a subpath export.
/**
 * PENGUIN_BUILD_JS_ONLY=1 skips the declarations: scripts/dev-prebuild.mjs builds this
 * package only so that the dev CLI's runtime imports of it resolve, and nothing at runtime
 * reads a .d.ts. The declaration pass is most of a full build's time. The declarations an
 * earlier full build left are kept rather than cleaned, so the CLI's and the desktop's
 * typecheck still find this package's types after a dev start.
 */
const jsOnly = process.env.PENGUIN_BUILD_JS_ONLY === "1";

const entry = {
  index: "src/index.ts",
  "api/types": "src/api/types.ts",
  lock: "src/lock.ts",
  // "./machine-status": what `penguin server status` prints. A CONTROLLER runs that command
  // over ssh to ask a machine what it is, so the reader has to be importable without a
  // server — see src/machine-status.ts.
  "machine-status": "src/machine-status.ts",
  // "./model-catalog": the built-in model catalog. No Node dependency — it imports core's
  // browser-safe connection subpath and MMSP's credentials module alone — so the Web App, the
  // component gallery and the CLI bundle the same rows, groups and helpers the server seeds a
  // Project with.
  "model-catalog": "src/model-catalog/index.ts",
  "initial-password": "src/initial-password.ts",
  "reset-admin-password": "src/reset-admin-password.ts",
  "auth-token": "src/auth-token.ts",
  "secret-file": "src/secret-file.ts",
  "hmr/manifest": "src/hmr/manifest.ts",
  "version-report": "src/version-report.ts",
  // "./plugin": the surface plugin PACKAGES compile against. Plugins live outside
  // this bundle entirely — they are configuration resolved from the installation,
  // not platform capability.
  "plugin/index": "src/plugin/index.ts",
};

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Declarations are bundled in two builds, each in a worker with its own heap. tsup's
 * declaration bundler makes a TypeScript program for every run of consecutive entries in one
 * directory (the first entry always gets one to itself), and most of these programs hold
 * nearly the whole server. One build over the entries in their order above made six programs
 * and peaked near 2.8 GB, past the default heap of a 7 GB macOS runner. Split as below, each
 * build makes two and stays near 1 GB. The API types build beside the plugin surface because
 * its declarations import them; a build without them would inline a copy.
 */
const { "plugin/index": pluginSurface, "api/types": apiTypes, ...rest } = entry;
const declarations = {
  "hmr/manifest": rest["hmr/manifest"],
  "model-catalog": rest["model-catalog"],
  ...Object.fromEntries(
    Object.entries(rest).filter(([, file]) => path.posix.dirname(file) === "src"),
  ),
};

const shared = {
  format: ["esm"],
  target: "node24",
  // The hot-update mechanism is a package for the boundary, not for npm (it is `private`):
  // inlined here so this package's published dist stays self-contained.
  noExternal: ["@prismshadow/penguin-hmr"],
  // Two builds write dist/ at once, so neither may clean it: it is emptied once, before both.
  clean: false,
} satisfies Options;

export default defineConfig(() => {
  // A JS-only build is one build, so it can clean for itself, sparing the declarations.
  if (!jsOnly) fs.rmSync(path.join(here, "dist"), { recursive: true, force: true });
  const builds: Options[] = [
    {
      ...shared,
      entry,
      ...(jsOnly ? { dts: false, clean: ["!**/*.d.ts"] } : { dts: { entry: declarations } }),
      sourcemap: true,
      // Scripts that run somewhere else, as REAL files beside the bundles: the release installers
      // a remote install feeds to the far side (the one thing that has to arrive before the CLI
      // does; everything after is a `penguin` subcommand the machine already has). Each is
      // resolved next to this module at runtime, so each has to exist in dist/ —
      // which `files: ["dist"]` is what npm ships. tsup only emits its entries, and these are
      // copied and never imported, so nothing in the module graph would pull them along. A
      // missing source throws here, failing the build rather than shipping a package whose
      // Machines page dies at "prepare the installer".
      //
      // The SET comes from scripts/far-side-scripts.mjs, shared with the hot push that has to
      // ship the same one (see that module): two hand-kept copies drifted once already.
      onSuccess: async () => {
        const repo = path.join(here, "..", "..");
        for (const { name, from } of [
          ...FAR_SIDE_SCRIPTS,
          ...LOCAL_AUDIO_ASSETS,
          ...MEDIA_PLACEHOLDER_ASSETS,
        ]) {
          fs.copyFileSync(path.join(repo, from), path.join(here, "dist", name));
        }
      },
    },
  ];
  if (!jsOnly) {
    builds.push({
      ...shared,
      entry: { "plugin/index": pluginSurface, "api/types": apiTypes },
      dts: { only: true },
    });
  }
  return builds;
});
