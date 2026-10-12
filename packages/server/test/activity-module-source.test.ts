/**
 * Which module a preview and a deploy use, and the module documents in effect for a ref:
 * the pin, the newest build, the checkout's module folder, and the edit-then-own-then-
 * canonical precedence, each pinned for both purposes.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { wire } from "@prismshadow/penguin-core/kernel";
import { ActivityModuleSourceService } from "../src/activities/module-source.js";
import { ActivityRunStore } from "../src/activities/run-store.js";
import type { ActivityDetail } from "../src/activities/domain.js";

const PROJECT = "proj";
const FOLDER = "waf-module-words";
const CODE = "words";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

async function write(file: string, content: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, typeof content === "string" ? content : JSON.stringify(content));
}

interface Setup {
  /** Succeeded module runs, newest first, as the runs index lists them. */
  builds?: string[];
  pinned?: string;
  /** Runs whose module holds a package.json. */
  packaged?: string[];
  /** Whether the checkout's module folder holds a definition. */
  checkoutModule?: boolean;
  wafRoot?: boolean;
  product?: boolean;
  refNum?: number;
  edits?: Partial<Record<string, { value: unknown; stale: boolean }>>;
  runs?: Record<string, { kind: string; status: string }>;
}

async function setup(options: Setup = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-module-source-"));
  roots.push(root);
  const penguin = path.join(root, "penguin");
  const waf = path.join(root, "waf");
  const checkout = path.join(waf, "modules", FOLDER);
  const runModule = (runId: string) => path.join(penguin, "activity-runs", runId, "module");
  const builds = options.builds ?? [];
  for (const runId of builds) await fs.mkdir(runModule(runId), { recursive: true });
  for (const runId of options.packaged ?? [])
    await write(path.join(runModule(runId), "package.json"), {});
  await fs.mkdir(checkout, { recursive: true });
  if (options.checkoutModule ?? true) await write(path.join(checkout, "definition.json"), {});
  const activity = {
    id: "act_1",
    productCode: CODE,
    refNum: options.refNum ?? 1,
    draft: options.pinned ? { pinnedModuleRunId: options.pinned } : {},
  } as unknown as ActivityDetail;
  const source = wire(ActivityModuleSourceService, {
    activities: {
      productOf: () =>
        options.product === false ? null : { moduleFolder: FOLDER, canonicalRefNum: 1 },
      effectiveModuleDocument: async (_p: string, _a: unknown, kind: string) =>
        options.edits?.[kind] ?? null,
    },
    generation: {
      moduleBuilds: async () =>
        builds.map((runId, index) => ({
          runId,
          kind: "module",
          status: "succeeded",
          createdAt: `2026-10-${String(20 - index).padStart(2, "0")}`,
        })),
      run: async (_p: string, _a: string, runId: string) => {
        const run = options.runs?.[runId];
        if (!run) throw new Error("run_not_found");
        return { runId, ...run };
      },
    },
    runs: wire(ActivityRunStore, { config: { root: penguin } }),
    config: { root: penguin },
    wafWorkspace: { root: async () => (options.wafRoot === false ? null : waf) },
  });
  return { source, activity, penguin, waf, checkout, runModule };
}

describe("the module a purpose uses", () => {
  it("previews the pinned build and deploys the newest", async () => {
    const { source, activity, runModule } = await setup({
      builds: ["run_new", "run_old"],
      pinned: "run_old",
      packaged: ["run_new", "run_old"],
    });
    expect((await source.build(PROJECT, activity, "preview"))?.runId).toBe("run_old");
    expect((await source.build(PROJECT, activity, "deploy"))?.runId).toBe("run_new");
    expect((await source.resolve(PROJECT, activity, "preview")).source).toEqual({
      kind: "run",
      root: runModule("run_old"),
    });
    expect((await source.resolve(PROJECT, activity, "deploy")).source).toEqual({
      kind: "run",
      root: runModule("run_new"),
    });
  });

  it("previews the newest build when the pin is no longer a succeeded build", async () => {
    const { source, activity } = await setup({ builds: ["run_new"], pinned: "run_gone" });
    expect((await source.build(PROJECT, activity, "preview"))?.runId).toBe("run_new");
  });

  it("previews the checkout's module without a build, and only when it holds one", async () => {
    const { source, activity, penguin, checkout } = await setup();
    expect(await source.resolve(PROJECT, activity, "preview")).toEqual({
      source: {
        kind: "checkout",
        root: checkout,
        output: path.join(penguin, "activity-sandbox", "modules", FOLDER),
        moduleFolder: FOLDER,
      },
      documentRoots: [checkout],
    });
    const empty = await setup({ checkoutModule: false });
    expect(await empty.source.resolve(PROJECT, empty.activity, "preview")).toEqual({
      source: null,
      documentRoots: [],
    });
    const noCheckout = await setup({ wafRoot: false });
    expect((await noCheckout.source.resolve(PROJECT, noCheckout.activity, "preview")).source).toBe(
      null,
    );
  });

  it("previews a run a play link names while it runs or once it succeeded, and nothing else", async () => {
    const { source, activity, runModule } = await setup({
      builds: ["run_new"],
      runs: {
        run_live: { kind: "module", status: "running" },
        run_bad: { kind: "module", status: "failed" },
        run_spec: { kind: "spec", status: "succeeded" },
      },
    });
    expect((await source.resolve(PROJECT, activity, "preview", "run_live")).source).toEqual({
      kind: "run",
      root: runModule("run_live"),
    });
    for (const runId of ["run_bad", "run_spec", "run_missing"])
      expect((await source.resolve(PROJECT, activity, "preview", runId)).source).toBeNull();
  });

  it("deploys a build only when it holds a package.json, reading documents from it then the checkout", async () => {
    const { source, activity, checkout, runModule } = await setup({
      builds: ["run_new"],
      packaged: ["run_new"],
    });
    expect(await source.resolve(PROJECT, activity, "deploy")).toEqual({
      source: { kind: "run", root: runModule("run_new") },
      documentRoots: [runModule("run_new"), checkout],
    });
    const unpackaged = await setup({ builds: ["run_new"] });
    expect(await unpackaged.source.resolve(PROJECT, unpackaged.activity, "deploy")).toEqual({
      source: null,
      documentRoots: [unpackaged.checkout],
    });
  });
});

describe("the module documents in effect for a ref", () => {
  it("is the author's edit, naming the file an assembly writes it to", async () => {
    const { source, activity, checkout } = await setup({
      refNum: 2,
      edits: { assessment: { value: { edited: true }, stale: true } },
    });
    await write(path.join(checkout, "assessments", "words-2.json"), { own: true });
    expect(await source.document(PROJECT, activity, "assessment", [checkout])).toEqual({
      file: "assessments/words-1.json",
      value: { edited: true },
      edited: true,
      stale: true,
    });
    // Asked for the module's own, the edit is passed over.
    expect(await source.document(PROJECT, activity, "assessment", [checkout], false)).toEqual({
      file: "assessments/words-2.json",
      value: { own: true },
      edited: false,
      stale: false,
    });
  });

  it("falls back on the canonical ref's assessment, but never on its configuration", async () => {
    const { source, activity, checkout } = await setup({ refNum: 2 });
    await write(path.join(checkout, "assessments", "words-1.json"), { shared: true });
    await write(path.join(checkout, "configurations", "words-1.json"), { shared: true });
    expect(await source.document(PROJECT, activity, "assessment", [checkout])).toMatchObject({
      file: "assessments/words-1.json",
      value: { shared: true },
    });
    expect(await source.document(PROJECT, activity, "configuration", [checkout])).toBeNull();
  });

  it("reads the roots in order, each for the ref's own file then the canonical's", async () => {
    const { source, activity, checkout, runModule } = await setup({ refNum: 2 });
    const run = runModule("run_new");
    await write(path.join(run, "assessments", "words-1.json"), { from: "run, canonical" });
    await write(path.join(checkout, "assessments", "words-2.json"), { from: "checkout, own" });
    await write(path.join(checkout, "configurations", "words-2.json"), { from: "checkout" });
    await write(path.join(run, "configurations", "words-2.json"), "not json");
    expect(
      (await source.document(PROJECT, activity, "assessment", [run, checkout]))?.value,
    ).toEqual({ from: "run, canonical" });
    expect(
      (await source.document(PROJECT, activity, "configuration", [run, checkout]))?.value,
    ).toEqual({ from: "checkout" });
  });

  it("reads the module's one definition, whatever the ref", async () => {
    const { source, activity, checkout } = await setup({ refNum: 2 });
    await write(path.join(checkout, "definition.json"), { id: "words" });
    expect(await source.document(PROJECT, activity, "definition", [checkout])).toEqual({
      file: "definition.json",
      value: { id: "words" },
      edited: false,
      stale: false,
    });
  });
});
