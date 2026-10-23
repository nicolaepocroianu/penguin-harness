/**
 * The pinned Sass every module stylesheet is compiled with: installed once under WAF Harness's
 * root, reused after, and run by its command line with this process's Node. npm is a fake
 * that lays out an install whose `sass.js` copies its input; the compile itself is a real
 * child process, from a folder whose name has a space in it.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { spawnDeployProcess, type DeployProcess } from "../src/activities/deploy-process.js";
import { PinnedSass, SASS_PACKAGE, sassHome } from "../src/activities/module-builder.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

/** A stand-in for the Sass command line: `sass.js <from> <to> --no-source-map` copies. */
const FAKE_CLI = `
const fs = require("fs");
const [from, to, flag] = process.argv.slice(2);
if (flag !== "--no-source-map") { console.error("unexpected " + flag); process.exit(64); }
const text = fs.readFileSync(from, "utf8");
if (text.includes("{{")) { console.error("Error: expected selector."); process.exit(65); }
fs.writeFileSync(to, "/* compiled */ " + text);
`;

async function setup(npm: { fail?: boolean } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wafh sass "));
  roots.push(root);
  const installs: string[] = [];
  /** The project `.npmrc` each install's npm would read, as it found it. */
  const npmrcs: (string | null)[] = [];
  const run: DeployProcess["run"] = async (command, args, options) => {
    if (command !== "npm") return spawnDeployProcess.run(command, args, options);
    installs.push(`${command} ${args.join(" ")}`);
    npmrcs.push(await fs.readFile(path.join(options.cwd, ".npmrc"), "utf8").catch(() => null));
    if (npm.fail) return { code: 1, tail: "npm ERR! network unreachable" };
    const sass = path.join(options.cwd, "node_modules", "sass");
    await fs.mkdir(sass, { recursive: true });
    await fs.writeFile(path.join(sass, "package.json"), JSON.stringify({ version: "1.54.0" }));
    await fs.writeFile(path.join(sass, "sass.js"), FAKE_CLI);
    return { code: 0, tail: "added 4 packages" };
  };
  const module = path.join(root, "module");
  await fs.mkdir(path.join(module, "res"), { recursive: true });
  return { root, module, installs, npmrcs, sass: new PinnedSass(sassHome(root), run) };
}

describe("the pinned Sass", () => {
  it("installs once, however many compiles ask at the same time, and compiles with it", async () => {
    const { root, module, installs, sass } = await setup();
    await fs.writeFile(path.join(module, "res", "style.scss"), ".a { color: red; }");
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        sass.compile({ cwd: module, from: "res/style.scss", to: "res/style.css" }),
      ),
    );
    expect(results.map((result) => result.code)).toEqual([0, 0, 0]);
    expect(installs).toEqual([`npm install ${SASS_PACKAGE} --no-audit --no-fund --ignore-scripts`]);
    expect(await fs.readFile(path.join(module, "res", "style.css"), "utf8")).toBe(
      "/* compiled */ .a { color: red; }",
    );
    // Installed into WAF Harness's root, with nothing left of the install in progress.
    expect(await fs.readdir(path.join(root, "tools"))).toEqual(["sass-1.54.0"]);
  });

  it("reuses an install a previous server left, asking npm nothing", async () => {
    const first = await setup();
    await first.sass.cli();
    const again = new PinnedSass(sassHome(first.root), async () => {
      throw new Error("npm was asked");
    });
    expect(await again.cli()).toBe(
      path.join(sassHome(first.root), "node_modules", "sass", "sass.js"),
    );
  });

  it("reports a stylesheet that does not compile with the compiler's words", async () => {
    const { module, sass } = await setup();
    await fs.writeFile(path.join(module, "res", "style.scss"), ".a {{ color: red; }");
    const result = await sass.compile({ cwd: module, from: "res/style.scss", to: "res/style.css" });
    expect(result.code).toBe(65);
    expect(result.tail).toContain("Error: expected selector.");
  });

  it("reports an install that failed, and tries again on the next compile", async () => {
    const failing = await setup({ fail: true });
    await fs.writeFile(path.join(failing.module, "res", "style.scss"), ".a {}");
    const job = { cwd: failing.module, from: "res/style.scss", to: "res/style.css" };
    const result = await failing.sass.compile(job);
    expect(result.code).toBe(1);
    expect(result.tail).toContain(`Installing ${SASS_PACKAGE} failed`);
    expect(result.tail).toContain("network unreachable");
    await failing.sass.compile(job);
    expect(failing.installs).toHaveLength(2);
    // Nothing half-installed is left to be mistaken for an install.
    expect(await fs.readdir(path.join(failing.root, "tools"))).toEqual([]);
  });

  it("installs from the registry the module's .npmrc names, and keeps no copy of it", async () => {
    const { root, module, npmrcs, sass } = await setup();
    const npmrc = [
      "registry=https://nexus.example.org/repository/npm-group/",
      "//nexus.example.org/:_authToken=secret",
      "",
    ].join("\n");
    await fs.writeFile(path.join(module, ".npmrc"), npmrc);
    await fs.writeFile(path.join(module, "res", "style.scss"), ".a {}");
    const result = await sass.compile({ cwd: module, from: "res/style.scss", to: "res/style.css" });
    expect(result.code).toBe(0);
    // npm ran with the module's settings as its project config.
    expect(npmrcs).toEqual([npmrc]);
    // The settings may hold credentials: the kept install has none of them.
    expect(await fs.readdir(sassHome(root))).not.toContain(".npmrc");
    expect(result.tail).not.toContain("secret");
  });

  it("installs with npm's own settings when the module has no .npmrc", async () => {
    const { module, npmrcs, sass } = await setup();
    await fs.writeFile(path.join(module, "res", "style.scss"), ".a {}");
    await sass.compile({ cwd: module, from: "res/style.scss", to: "res/style.css" });
    expect(npmrcs).toEqual([null]);
  });
});
