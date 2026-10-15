import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BUILD_LOG_MAX,
  moduleBuildScript,
  spawnModuleBuild,
} from "../src/activities/sandbox-build-runner.js";
import type { StyleJob, StyleResult } from "../src/activities/module-builder.js";
import { spawnCheckoutBuild } from "../src/activities/sandbox-checkout-build.js";

/** A stylesheet compiler that writes what it is given, or fails as told; it records each job. */
function compiler(result: Partial<StyleResult> = {}) {
  const jobs: StyleJob[] = [];
  return {
    jobs,
    async compileStyle(job: StyleJob): Promise<StyleResult> {
      jobs.push(job);
      if (!result.code) {
        const scss = await fs.readFile(path.resolve(job.cwd, job.from), "utf8");
        await fs.writeFile(path.resolve(job.cwd, job.to), `/* from scss */ ${scss}`);
      }
      return { code: 0, tail: "", ...result };
    },
  };
}

describe("a build log", () => {
  it("has a bound a webpack failure fits inside", () => {
    expect(BUILD_LOG_MAX).toBeGreaterThan(64 * 1024);
  });
});

describe("running a module's own build", () => {
  const cleanups: (() => Promise<unknown>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  /** A workspace whose `npm run build` is a node script we control. */
  async function workspace(script: string) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-build-"));
    cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
    await fs.writeFile(path.join(dir, "build.js"), script, "utf8");
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "m", version: "1.0.0", scripts: { build: "node build.js" } }),
      "utf8",
    );
    return dir;
  }

  it("reports a build that succeeded, with its output", async () => {
    const dir = await workspace('console.log("compiled 3 modules");');
    const outcome = await spawnModuleBuild(dir, compiler());
    expect(outcome.ok).toBe(true);
    expect(outcome.log).toContain("compiled 3 modules");
  });

  it("reports a build that failed, with its output and its exit code", async () => {
    const dir = await workspace('console.error("Module not found: ./missing"); process.exit(2);');
    const outcome = await spawnModuleBuild(dir, compiler());
    expect(outcome.ok).toBe(false);
    expect(outcome.log).toContain("Module not found");
    expect(outcome.log).toContain("exited with code 2");
  });

  it("treats a build that cannot start as a failed build with a reason", async () => {
    // The author asked to see their activity; "there is no build script" answers that, and
    // an exception thrown at whoever requested the preview does not.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-build-"));
    cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
    const outcome = await spawnModuleBuild(dir, compiler());
    expect(outcome.ok).toBe(false);
    expect(outcome.log.length).toBeGreaterThan(0);
  });

  it("falls back to the scaffold's buildDebug when there is no build script", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-build-"));
    cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
    await fs.writeFile(path.join(dir, "build.js"), 'console.log("debug bundle");', "utf8");
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "m", version: "1.0.0", scripts: { buildDebug: "node build.js" } }),
      "utf8",
    );
    expect(moduleBuildScript(dir)).toBe("buildDebug");
    const outcome = await spawnModuleBuild(dir, compiler());
    expect(outcome.ok).toBe(true);
    expect(outcome.log).toContain("debug bundle");
  });

  it("says so when the module has neither script", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-build-"));
    cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ scripts: {} }), "utf8");
    expect(moduleBuildScript(dir)).toBeNull();
    const outcome = await spawnModuleBuild(dir, compiler());
    expect(outcome.ok).toBe(false);
    expect(outcome.log).toContain("no build or buildDebug script");
  });

  it("compiles res/style.scss to the style.css the definition requires before building", async () => {
    // WAF's builder copies res/ as is: without this the build ships style.scss, the player
    // fails on the missing style.css, and the layout never mounts.
    const dir = await workspace(
      'const fs = require("fs"); console.log("saw css: " + fs.readFileSync("res/style.css", "utf8").includes(".a .b"));',
    );
    await fs.mkdir(path.join(dir, "res"));
    await fs.writeFile(path.join(dir, "res", "style.scss"), ".a .b { color: red; }", "utf8");
    const sass = compiler();
    const outcome = await spawnModuleBuild(dir, sass);
    expect(sass.jobs).toMatchObject([{ cwd: dir, from: "res/style.scss", to: "res/style.css" }]);
    expect(outcome.ok).toBe(true);
    expect(outcome.log).toContain("Compiled res/style.scss to res/style.css.");
    expect(outcome.log).toContain("saw css: true");
  });

  it("does not build when the stylesheet does not compile, and says why", async () => {
    const dir = await workspace('console.log("built anyway");');
    await fs.mkdir(path.join(dir, "res"));
    await fs.writeFile(path.join(dir, "res", "style.scss"), ".a { color: ", "utf8");
    const outcome = await spawnModuleBuild(
      dir,
      compiler({ code: 65, tail: 'Error: expected "}".' }),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.log).toContain('Error: expected "}".');
    expect(outcome.log).toContain("res/style.scss did not compile.");
    expect(outcome.log).not.toContain("built anyway");
  });

  it("asks for no stylesheet compile when the module has none", async () => {
    const dir = await workspace('console.log("plain css");');
    const sass = compiler();
    expect((await spawnModuleBuild(dir, sass)).ok).toBe(true);
    expect(sass.jobs).toEqual([]);
  });

  it("stops a build that takes too long and says so", async () => {
    const dir = await workspace("setTimeout(() => {}, 60000);");
    const outcome = await spawnModuleBuild(dir, { ...compiler(), timeoutMs: 300 });
    expect(outcome.ok).toBe(false);
    expect(outcome.log).toContain("taking too long");
  });
});

describe("building a checkout module", () => {
  const cleanups: (() => Promise<unknown>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  /** A checkout module with this stylesheet, and no webpack anywhere. */
  async function checkout(stylesheet: Record<string, string>) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-checkout-build-"));
    cleanups.push(() => fs.rm(root, { recursive: true, force: true }));
    const job = {
      moduleRoot: path.join(root, "modules", "navbar"),
      outputRoot: path.join(root, "out"),
      frameworkRoot: path.join(root, "framework"),
      moduleId: "navBar",
    };
    await fs.mkdir(path.join(job.moduleRoot, "res"), { recursive: true });
    await fs.mkdir(job.frameworkRoot, { recursive: true });
    for (const [name, text] of Object.entries(stylesheet))
      await fs.writeFile(path.join(job.moduleRoot, "res", name), text);
    return job;
  }

  it("compiles the module's SCSS stylesheet into Penguin's output, under the name it has", async () => {
    const job = await checkout({ "default.scss": ".nav { color: red; }" });
    const sass = compiler();
    const outcome = await spawnCheckoutBuild(job, sass);
    const css = path.join(job.outputRoot, "default.css");
    expect(sass.jobs).toEqual([{ cwd: job.moduleRoot, from: "res/default.scss", to: css }]);
    expect(await fs.readFile(css, "utf8")).toContain(".nav");
    // The checkout itself is only read.
    expect(await fs.readdir(path.join(job.moduleRoot, "res"))).toEqual(["default.scss"]);
    // There is no webpack in this checkout, which the build then says.
    expect(outcome.ok).toBe(false);
    expect(outcome.log).toContain("Compiled res/default.scss");
    expect(outcome.log).toContain("Neither the module nor the framework has webpack installed");
  });

  it("does not build when the stylesheet does not compile", async () => {
    const job = await checkout({ "style.scss": ".a { color: " });
    const outcome = await spawnCheckoutBuild(job, compiler({ code: 65, tail: "Error: bad" }));
    expect(outcome.ok).toBe(false);
    expect(outcome.log).toContain("res/style.scss did not compile.");
    expect(outcome.log).not.toContain("webpack");
  });

  it("compiles nothing for a module whose stylesheet is plain CSS", async () => {
    const job = await checkout({ "style.css": ".a {}" });
    const sass = compiler();
    await spawnCheckoutBuild(job, sass);
    expect(sass.jobs).toEqual([]);
  });
});
