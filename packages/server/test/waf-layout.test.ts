/**
 * The WAF checkout's folder grammar. Every path is pinned to the string the checkout and the
 * stored drafts already use: a change here moves files Penguin and Loom have written.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-waf-layout-"));
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
    [
      "the checkout of a module",
      WafLayout.containing(MODULE).repo("framework"),
      path.join(ROOT, "framework"),
    ],
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
