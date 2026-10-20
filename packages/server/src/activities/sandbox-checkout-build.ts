/**
 * Building a module that lives in the WAF checkout, without writing to the checkout.
 *
 * Loom's dev sandbox did not run a module's own `npm run build`: it compiled `src` with
 * webpack into a cache of its own, resolving dependencies from the module's
 * `node_modules` and then the framework's, and compiled `res/style.scss` beside it. This is
 * that build, ported, so a Loom-generated module previews the way it did in Loom. Its
 * output goes under Penguin's root; the checkout is only read. Its stylesheet is compiled
 * with the Sass a deploy uses (see module-builder.ts), before webpack runs.
 *
 * It runs as a child Node process rather than in the server. Webpack and the module's
 * TypeScript are the module's and the framework's own versions, loaded from the checkout,
 * and a build that exhausts memory or never returns must not take the server with it.
 */
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { StyleCompiler } from "./module-builder.js";
import { nodeRequirementNote } from "./node-requirement.js";
import { moduleToolchainFolders } from "./npm-workspace.js";
import { clampLog } from "./run-program.js";
import {
  BUILD_LOG_MAX,
  spawnNodeScript,
  styleOutcome,
  type BuildOutcome,
} from "./sandbox-build-runner.js";

/** What one checkout build needs to know. */
export interface CheckoutBuildJob {
  /** The module folder in the checkout, read only. */
  moduleRoot: string;
  /** Where the build writes `entry.js` and `style.css`. Penguin's, never the checkout. */
  outputRoot: string;
  /** The WAF framework, whose `node_modules` the module falls back on. */
  frameworkRoot: string;
  /** The definition's id, compiled in as `MODULE_ID` as Loom does. */
  moduleId: string;
  /** The media repository, handed to the build as WAF_MEDIA_DIR as Loom hands it; none when absent. */
  mediaRoot?: string;
}

/**
 * Where a checkout module's packages are, nearest first: the module's own `node_modules`, each
 * one up to its npm workspace's root when it is in one (where a monorepo hoists them), then
 * the framework's. Nothing above a module outside a workspace counts (see npm-workspace.ts).
 */
export function packageDirs(moduleRoot: string, frameworkRoot: string): string[] {
  const found = moduleToolchainFolders(moduleRoot)
    .map((dir) => path.join(dir, "node_modules"))
    .filter((dir) => existsSync(dir));
  const framework = path.join(path.resolve(frameworkRoot), "node_modules");
  if (existsSync(framework) && !found.includes(framework)) found.push(framework);
  return found;
}

/**
 * The build, as the child runs it. CommonJS on stdin; the job arrives in the environment.
 *
 * Kept as close to Loom's `createModuleWebpackConfig` as the difference in where it writes
 * allows: webpack from the module if it has one and from the framework otherwise, the same
 * four dependency aliases, the same `waf-sequence` shim that bootstraps sequences with a
 * hydrated configuration, and TypeScript compiled first when the module has a
 * `tsconfig.build.json` -- into the output directory, not the module's own.
 */
export const CHECKOUT_BUILD_SCRIPT = String.raw`
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const { createRequire } = require('module');

const job = JSON.parse(process.env.PENGUIN_CHECKOUT_BUILD);
// Resolved, because webpack 4's schema refuses a Windows path written with forward slashes.
const moduleRoot = path.resolve(job.moduleRoot);
const outputRoot = path.resolve(job.outputRoot);
const frameworkRoot = path.resolve(job.frameworkRoot);
const { moduleId, styleName, styleCompiled, packageDirs } = job;

function fail(message) {
    console.error(message);
    process.exit(1);
}

function isMissing(error, name) {
    return error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes("'" + name + "'");
}

// Node finds a package from the module up through its workspace's root, where npm hoists it.
function loadWebpack() {
    for (const base of [moduleRoot, frameworkRoot]) {
        try {
            const at = createRequire(path.join(base, 'package.json')).resolve('webpack');
            const webpack = require(at);
            console.log('webpack ' + webpack.version + ' from ' + at);
            return webpack;
        } catch (error) {
            if (!isMissing(error, 'webpack')) throw error;
        }
    }
    fail('Neither the module, its workspace nor the framework has webpack installed. Run npm install in the module, or at its workspace root.');
}

function dependencyPath(name) {
    for (const dir of packageDirs) {
        const candidate = path.join(dir, name);
        if (fs.existsSync(candidate)) return candidate;
    }
    return undefined;
}

function writeSequenceShim() {
    const dir = path.join(outputRoot, '.preview');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'waf-sequence.js'), [
        "import * as wafSequenceRuntime from 'waf-sequence-runtime';",
        "export * from 'waf-sequence-runtime';",
        'export function bootstrapSequence(sequence, options) {',
        '    return wafSequenceRuntime.bootstrapSequence(sequence, { ...(options || {}), hydrateConfig: true });',
        '}',
        '',
    ].join('\n'));
    return path.join(dir, 'waf-sequence.js');
}

function aliases() {
    const found = {};
    for (const name of ['pubsubsingleton', 'input-manager-system', 'waf-utils', 'waf-sequence']) {
        const at = dependencyPath(name);
        if (at) found[name] = at;
    }
    if (!found['waf-sequence']) return found;
    const runtime = found['waf-sequence'];
    delete found['waf-sequence'];
    return { 'waf-sequence$': writeSequenceShim(), 'waf-sequence-runtime$': runtime, ...found };
}

function entryPath() {
    for (const name of ['index.ts', 'index.js']) {
        const candidate = path.join(moduleRoot, 'src', name);
        if (fs.existsSync(candidate)) return candidate;
    }
    fail('The module has no src/index.ts or src/index.js to build.');
}

// The compiler is the one TypeScript's package.json names: TypeScript 7's bin/tsc is an ES
// module that loads its native compiler, where older versions shipped the compiler itself.
function compileTypeScript(entry) {
    const manifestPath = createRequire(path.join(moduleRoot, 'package.json')).resolve('typescript/package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const bin = typeof manifest.bin === 'string' ? manifest.bin : (manifest.bin && manifest.bin.tsc) || 'bin/tsc';
    const tsc = path.resolve(path.dirname(manifestPath), bin);
    console.log('TypeScript ' + manifest.version + ' from ' + tsc);
    const outDir = path.join(outputRoot, '.typescript-build');
    const result = childProcess.spawnSync(
        process.execPath,
        [tsc, '--project', 'tsconfig.build.json', '--outDir', outDir, '--rootDir', 'src'],
        { cwd: moduleRoot, encoding: 'utf8', windowsHide: true }
    );
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    if (result.status !== 0) fail('TypeScript did not compile.');
    return path.join(outDir, path.relative(path.join(moduleRoot, 'src'), entry).replace(/\.ts$/, '.js'));
}

// The server compiled an SCSS stylesheet into the output already; a plain one is copied.
function buildStyle() {
    if (styleCompiled) return;
    const css = path.join(moduleRoot, 'res', styleName + '.css');
    if (fs.existsSync(css)) {
        fs.copyFileSync(css, path.join(outputRoot, styleName + '.css'));
        return;
    }
    fail('The module has no res/style.scss or res/style.css.');
}

function config(webpack) {
    let entry = entryPath();
    const result = {
        mode: 'development',
        devtool: 'cheap-module-source-map',
        target: 'web',
        context: moduleRoot,
        entry,
        output: { filename: 'entry.js', path: outputRoot },
        resolve: {
            extensions: ['.ts', '.js', '.json'],
            symlinks: false,
            modules: [...packageDirs, 'node_modules'],
            alias: aliases(),
        },
        plugins: [new webpack.DefinePlugin({ MODULE_ID: JSON.stringify(moduleId) })],
    };
    if (path.extname(entry) === '.ts') {
        if (fs.existsSync(path.join(moduleRoot, 'tsconfig.build.json'))) {
            result.entry = compileTypeScript(entry);
            result.resolve.extensions = ['.js', '.json'];
        } else {
            result.module = {
                rules: [{
                    test: /\.ts$/,
                    exclude: /node_modules/,
                    use: {
                        loader: createRequire(path.join(moduleRoot, 'package.json')).resolve('ts-loader'),
                        options: { transpileOnly: true },
                    },
                }],
            };
        }
    }
    return result;
}

fs.mkdirSync(outputRoot, { recursive: true });
const webpack = loadWebpack();
buildStyle();
webpack(config(webpack), (error, stats) => {
    if (error) fail(error.stack || String(error));
    console.log(stats.toString({ colors: false, all: false, assets: true, errors: true, warnings: true }));
    process.exit(stats.hasErrors() ? 1 : 0);
});
`;

/**
 * A module's stylesheet is `res/style`; the navbar's is `res/default`. Either way the build
 * writes the name the definition asks for.
 */
function stylesheetName(moduleRoot: string): string {
  const res = path.join(moduleRoot, "res");
  const named = (base: string) =>
    existsSync(path.join(res, `${base}.scss`)) || existsSync(path.join(res, `${base}.css`));
  return ["style", "default"].find(named) ?? "style";
}

/**
 * Builds a checkout module into its output directory, and reports how it went: an SCSS
 * stylesheet compiled into the output first, then the build.
 *
 * Never throws, like every build here: a module that does not compile is an answer to the
 * author who asked to see it.
 */
export async function spawnCheckoutBuild(
  job: CheckoutBuildJob,
  options: { timeoutMs?: number; compileStyle: StyleCompiler },
): Promise<BuildOutcome> {
  // A module that asks for another Node than the server's is still built with the server's,
  // since Penguin installs no Node; the log says so first, so a failure is read with it.
  const nodeNote = nodeRequirementNote(job.moduleRoot, process.version);
  const notes = nodeNote ? `${nodeNote}\n` : "";
  const styleName = stylesheetName(job.moduleRoot);
  const scss = `res/${styleName}.scss`;
  const styleCompiled = existsSync(path.join(job.moduleRoot, scss));
  let styleLog = "";
  if (styleCompiled) {
    const css = path.join(job.outputRoot, `${styleName}.css`);
    await mkdir(job.outputRoot, { recursive: true });
    const style = styleOutcome(
      await options.compileStyle({ cwd: job.moduleRoot, from: scss, to: css }),
      scss,
      css,
    );
    if (!style.ok) return { ok: false, log: clampLog(notes + style.log, BUILD_LOG_MAX) };
    styleLog = style.log;
  }
  const packages = packageDirs(job.moduleRoot, job.frameworkRoot);
  const built = await spawnNodeScript(
    CHECKOUT_BUILD_SCRIPT,
    {
      cwd: job.moduleRoot,
      env: {
        PENGUIN_CHECKOUT_BUILD: JSON.stringify({
          ...job,
          styleName,
          styleCompiled,
          packageDirs: packages,
        }),
        ...(job.mediaRoot ? { WAF_MEDIA_DIR: job.mediaRoot } : {}),
        // Webpack 4, which Loom's modules pin, hashes with MD4; Node 17+ refuses it
        // without the legacy provider. Harmless to webpack 5.
        NODE_OPTIONS: [process.env.NODE_OPTIONS, "--openssl-legacy-provider"]
          .filter(Boolean)
          .join(" "),
      },
    },
    options,
  );
  return { ok: built.ok, log: clampLog(notes + styleLog + built.log, BUILD_LOG_MAX) };
}
