/**
 * The WAF checkout's folder grammar. Every path is pinned to the string the checkout and the
 * stored drafts already use: a change here moves files WAF Harness and Loom have written.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  childFolders,
  findWafRoot,
  mediaReference,
  mediaRepoPath,
  mediaSparsePath,
  moduleDocumentPath,
  ModuleLayout,
  moduleShortName,
  parseRefFolderName,
  refMediaFolder,
  refSpecPath,
  setMonorepoModuleRoots,
  WafLayout,
} from "../src/activities/waf-layout.js";

const ROOT = path.resolve("/srv/waf");
const checkout = new WafLayout(ROOT);
const MODULE = path.join(ROOT, "modules", "waf-module-words");
const module = checkout.module("waf-module-words");

const cleanups: string[] = [];
afterEach(async () => {
  for (const dir of cleanups.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});
async function directory(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wafh-waf-layout-"));
  cleanups.push(dir);
  return dir;
}

describe("the WAF checkout", () => {
  it.each([
    ["framework", checkout.repo("framework"), path.join(ROOT, "framework")],
    ["navbar", checkout.repo("navbar"), path.join(ROOT, "modules", "navbar")],
    ["media", checkout.repo("media"), path.join(ROOT, "media")],
    ["activity data", checkout.repo("activityData"), path.join(ROOT, "waf-activity-data")],
    ["modules", checkout.modulesDir, path.join(ROOT, "modules")],
    ["a module", checkout.moduleDir("waf-module-words"), MODULE],
    ["a module's repository", module.root, MODULE],
  ])("places %s", (_, actual, expected) => {
    expect(actual).toBe(expected);
  });

  it.each([
    ["a parent", ".."],
    ["a sibling", "../media"],
    ["an absolute path", path.resolve("/elsewhere/module")],
    ["nothing", ""],
    ["the folder itself", "."],
  ])("keeps a module folder naming %s inside modules/", (_, folder) => {
    expect(checkout.moduleDir(folder)).toBeNull();
    expect(() => checkout.module(folder)).toThrow(
      expect.objectContaining({ status: 400, code: "module_folder_invalid" }),
    );
  });

  it.each([
    [
      "a ref's media",
      "media/loom/words/words-3/images/en/cat.png",
      path.join(ROOT, "media", "loom", "words", "words-3", "images", "en", "cat.png"),
    ],
    [
      "a shared file",
      "media/videos/loading/x.mp4",
      path.join(ROOT, "media", "videos", "loading", "x.mp4"),
    ],
    ["a path outside media/", "modules/navbar/definition.json", null],
    ["the media folder itself", "media/", null],
    ["a way out of media/", "media/../modules/navbar/definition.json", null],
    ["a way out of the checkout", "media/../../etc/passwd", null],
  ])("finds %s in the media repository", (_, reference, expected) => {
    expect(checkout.mediaFile(reference)).toBe(expected);
  });

  it("lists every product in the modules, by folder then code", async () => {
    const root = await directory();
    for (const dir of [
      "modules/waf-module-b/generated/b2",
      "modules/waf-module-b/generated/b1",
      "modules/waf-module-a/generated/a",
      "modules/navbar/src",
    ])
      await fs.mkdir(path.join(root, dir), { recursive: true });
    await fs.writeFile(path.join(root, "modules/waf-module-a/generated/notes.txt"), "");
    expect(await new WafLayout(root).products()).toEqual([
      { moduleFolder: "waf-module-a", productCode: "a" },
      { moduleFolder: "waf-module-b", productCode: "b1" },
      { moduleFolder: "waf-module-b", productCode: "b2" },
    ]);
    expect(await new WafLayout(path.join(root, "missing")).products()).toEqual([]);
  });

  it("discovers only a complete ancestor checkout and honors an explicit invalid root", async () => {
    const root = await directory();
    const child = path.join(root, "projects", "one");
    for (const name of ["framework/src", "modules", "media", "projects/one"])
      await fs.mkdir(path.join(root, name), { recursive: true });
    await fs.writeFile(path.join(root, "framework/package.json"), "{}");
    expect(await findWafRoot(child, "")).toBe(await fs.realpath(root));
    expect(await findWafRoot(child, child)).toBeNull();
    await fs.rm(path.join(root, "media"), { recursive: true });
    expect(await findWafRoot(child, root)).toBeNull();
  });
});

/** A link to a folder: a junction on Windows, which needs no privilege; a symlink elsewhere. */
async function linkFolder(target: string, link: string) {
  await fs.mkdir(path.dirname(link), { recursive: true });
  await fs.symlink(target, link, process.platform === "win32" ? "junction" : "dir");
}

describe("a monorepo modules root beside the checkout's", () => {
  /** A checkout with one module of its own, and a monorepo with two, one of the same name. */
  async function roots() {
    const base = await directory();
    const root = path.join(base, "waterford");
    const monorepo = path.join(base, "waf-modules", "modules");
    for (const dir of [
      "waterford/modules/navbar/src",
      "waterford/modules/waf-module-legacy/generated/legacy",
      "waterford/modules/waf-module-both/generated/fromcheckout",
      "waf-modules/modules/waf-module-m2ab01/generated/m2ab01",
      "waf-modules/modules/waf-module-both/generated/frommonorepo",
    ])
      await fs.mkdir(path.join(base, dir), { recursive: true });
    return { root, monorepo };
  }

  it("lists the products of both roots, a folder in both once, from the monorepo", async () => {
    const { root, monorepo } = await roots();
    expect(await new WafLayout(root, [monorepo]).products()).toEqual([
      { moduleFolder: "waf-module-both", productCode: "frommonorepo" },
      { moduleFolder: "waf-module-legacy", productCode: "legacy" },
      { moduleFolder: "waf-module-m2ab01", productCode: "m2ab01" },
    ]);
  });

  it("finds an existing folder in the monorepo first, and makes a new one in the checkout", async () => {
    const { root, monorepo } = await roots();
    const checkout = new WafLayout(root, [monorepo]);
    expect(checkout.moduleDir("waf-module-m2ab01")).toBe(path.join(monorepo, "waf-module-m2ab01"));
    expect(checkout.moduleDir("waf-module-both")).toBe(path.join(monorepo, "waf-module-both"));
    expect(checkout.moduleDir("waf-module-legacy")).toBe(
      path.join(root, "modules", "waf-module-legacy"),
    );
    expect(checkout.moduleDir("waf-module-new")).toBe(path.join(root, "modules", "waf-module-new"));
    expect(checkout.repo("navbar")).toBe(path.join(root, "modules", "navbar"));
    expect(checkout.inMonorepo("waf-module-m2ab01")).toBe(true);
    expect(checkout.inMonorepo("waf-module-legacy")).toBe(false);
    expect(checkout.inMonorepo("waf-module-new")).toBe(false);
  });

  it.each([
    ["a parent", ".."],
    ["a sibling of the monorepo's modules", "../package.json"],
    ["an absolute path", path.resolve("/elsewhere/module")],
    ["nothing", ""],
  ])("keeps a module folder naming %s inside a modules root", async (_, folder) => {
    const { root, monorepo } = await roots();
    expect(new WafLayout(root, [monorepo]).moduleDir(folder)).toBeNull();
  });

  it("gives every layout of a checkout the monorepo the workspace set for it", async () => {
    const { root, monorepo } = await roots();
    setMonorepoModuleRoots(root, [monorepo]);
    try {
      expect(new WafLayout(root).monorepoModuleRoots).toEqual([monorepo]);
      expect(new WafLayout(path.join(root, "..", "other")).monorepoModuleRoots).toEqual([]);
    } finally {
      setMonorepoModuleRoots(root, []);
    }
    expect(new WafLayout(root).monorepoModuleRoots).toEqual([]);
  });
});

describe("linked folders", () => {
  it("counts a link to a folder as a folder, and a link to a file or nowhere as none", async () => {
    const base = await directory();
    const dir = path.join(base, "dir");
    await fs.mkdir(path.join(base, "elsewhere", "real"), { recursive: true });
    await fs.mkdir(path.join(dir, "plain"), { recursive: true });
    await fs.writeFile(path.join(base, "elsewhere", "file.txt"), "");
    await linkFolder(path.join(base, "elsewhere", "real"), path.join(dir, "linked"));
    await linkFolder(path.join(base, "elsewhere", "gone"), path.join(dir, "dangling"));
    await fs.writeFile(path.join(dir, "file.txt"), "");
    expect(await childFolders(dir)).toEqual(["linked", "plain"]);
    expect(await childFolders(path.join(base, "missing"))).toEqual([]);
  });

  it("lists the products of linked module and product folders", async () => {
    const base = await directory();
    const root = path.join(base, "waf");
    await fs.mkdir(path.join(base, "elsewhere", "waf-module-a", "generated", "a"), {
      recursive: true,
    });
    await fs.mkdir(path.join(base, "products", "b"), { recursive: true });
    await fs.mkdir(path.join(root, "modules", "waf-module-b", "generated"), { recursive: true });
    await linkFolder(
      path.join(base, "elsewhere", "waf-module-a"),
      path.join(root, "modules", "waf-module-a"),
    );
    await linkFolder(
      path.join(base, "products", "b"),
      path.join(root, "modules", "waf-module-b", "generated", "b"),
    );
    expect(await new WafLayout(root).products()).toEqual([
      { moduleFolder: "waf-module-a", productCode: "a" },
      { moduleFolder: "waf-module-b", productCode: "b" },
    ]);
  });
});

describe("a module repository", () => {
  const product = path.join(MODULE, "generated", "words");
  it.each([
    ["the generated folder", module.generatedDir, path.join(MODULE, "generated")],
    ["a product", module.productDir("words"), product],
    ["a product's spec", module.productSpecDir("words"), path.join(product, "spec")],
    ["a product's refs", module.refsDir("words"), path.join(product, "refs")],
    ["a ref", module.refDir("words", 3), path.join(product, "refs", "words-3")],
    ["a ref's spec", module.refSpecDir("words", 3), path.join(product, "refs", "words-3", "spec")],
    [
      "a configuration",
      module.document("configuration", "words", 3),
      path.join(MODULE, "configurations", "words-3.json"),
    ],
    [
      "an assessment",
      module.document("assessment", "words", 3),
      path.join(MODULE, "assessments", "words-3.json"),
    ],
    [
      "the definition",
      module.document("definition", "words", 3),
      path.join(MODULE, "definition.json"),
    ],
    [
      "a run's module",
      new ModuleLayout(path.join("/runs", "run_1", "module")).refSpecDir("w-2", 0),
      path.join("/runs", "run_1", "module", "generated", "w-2", "refs", "w-2-0", "spec"),
    ],
  ])("places %s", (_, actual, expected) => {
    expect(actual).toBe(expected);
  });

  it.each([
    ["a ref's spec", refSpecPath("words", 3), "generated/words/refs/words-3/spec"],
    [
      "a configuration",
      moduleDocumentPath("configuration", "words", 3),
      "configurations/words-3.json",
    ],
    ["an assessment", moduleDocumentPath("assessment", "words", 3), "assessments/words-3.json"],
    ["the definition", moduleDocumentPath("definition", "words", 3), "definition.json"],
  ])("names %s as the module does", (_, actual, expected) => {
    expect(actual).toBe(expected);
  });

  it.each([
    ["words", "words-3", 3],
    ["words", "words-0", 0],
    ["w-2", "w-2-10", 10],
    ["w-2", "w-10", null],
    ["words", "words-03", null],
    ["words", "words-", null],
    ["words", "other-3", null],
  ])("reads %s's ref folder %s", (code, name, refNum) => {
    expect(parseRefFolderName(code, name)).toBe(refNum);
  });
});

describe("media and naming", () => {
  it.each([
    ["a ref's media folder", refMediaFolder("words", 3), "media/loom/words/words-3"],
    ["a product's sparse folder", mediaSparsePath("words"), "loom/words"],
    ["a reference in the repository", mediaRepoPath("media/loom/words/a.png"), "loom/words/a.png"],
    ["a reference outside media/", mediaRepoPath("uploads/a.png"), null],
    ["the bare prefix", mediaRepoPath("media/"), null],
    [
      "a repository path as a reference",
      mediaReference("loom/words/a.png"),
      "media/loom/words/a.png",
    ],
    ["a module's short name", moduleShortName("waf-module-words"), "words"],
    ["an old module's short name", moduleShortName("wafmodule-abc"), "abc"],
    ["any other folder's short name", moduleShortName("custom"), "custom"],
  ])("names %s", (_, actual, expected) => {
    expect(actual).toBe(expected);
  });
});
