/**
 * Previewing a module Loom left in the WAF checkout.
 *
 * An imported activity has no module run of its own: its module is the folder Loom
 * generated under `modules/`, and its media sits under the checkout's `media/`. What this
 * covers is that the sandbox finds both there, never writes to the checkout, and still
 * prefers what WAF Harness built itself -- plus the signed link a played preview is served
 * behind.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ActivityPlayLinksService, playKey, readPlayKey } from "../src/activities/play-links.js";
import { ActivitySandboxService } from "../src/activities/sandbox-service.js";
import { checkoutOutputRoot, definitionMediaFolders } from "../src/activities/sandbox-source.js";
import { fakeModuleBuilder, wiredSandbox } from "./activity-sandbox-wiring.js";

const PROJECT = "proj";
const ACTIVITY = "act_1";
const FOLDER = "waf-module-sight-words";

const spec = {
  id: "sight-words",
  title: "Sight Words",
  runtime: { engine: "html", layout: "mainOnly", theme: "park", resolution: "640x480" },
  scenes: [{ id: "intro" }],
};

async function write(file: string, content: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, typeof content === "string" ? content : JSON.stringify(content));
}

/** A checkout with one Loom module and its media, a WAF Harness root, and a service over both. */
async function setup(
  options: { runs?: boolean; canonical?: boolean; confinementProblem?: string } = {},
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wafh-checkout-"));
  const wafh = path.join(root, "wafh");
  const waf = path.join(root, "waf");
  const moduleRoot = path.join(waf, "modules", FOLDER);
  await write(path.join(moduleRoot, "definition.json"), {
    id: "sightWords",
    require: {
      entry: { type: "javascript", url: "entry.js" },
      layout: { type: "html", url: "layout.html" },
      font: { type: "css", url: "{{MEDIA}}/fonts/Waterford.css" },
    },
    themes: {
      park: {
        assets: { cover: { type: "image", url: "{{MEDIA}}/loom/sight-words/cover.jpg" } },
        properties: {},
      },
    },
  });
  await write(path.join(moduleRoot, "package.json"), { version: "1.0.17" });
  await write(path.join(moduleRoot, "configurations", "sight-words-1.json"), {
    sightWords: { intro: { audio: "{{MEDIA}}/loom/sight-words/intro.mp3" } },
  });
  await write(path.join(moduleRoot, "res", "layout.html"), "<div>checkout layout</div>");
  await write(path.join(moduleRoot, "src", "index.js"), "module.exports = {};");
  await write(path.join(moduleRoot, "generated", "sight-words", "spec", "notes.json"), {});
  await write(path.join(waf, "media", "loom", "sight-words", "cover.jpg"), "checkout cover");
  await write(path.join(wafh, "drafts", "media", "loom", "sight-words", "intro.mp3"), "draft");

  if (options.runs) {
    const runModule = path.join(wafh, "activity-runs", "run_1", "module");
    await write(path.join(runModule, "definition.json"), {
      id: "sightWords",
      require: { entry: { type: "javascript", url: "entry.js" } },
      themes: { park: { assets: {}, properties: { from: "wafh" } } },
    });
  }

  const activity = {
    id: ACTIVITY,
    collectionId: "col",
    productCode: "sight-words",
    refNum: 1,
    title: "Sight Words",
    draft: { draftId: "d", status: "valid", spec, contentRevision: "rev0123456789abcdef" },
  };
  const generation: Record<string, unknown> = {
    moduleBuilds: async () =>
      options.runs
        ? [{ runId: "run_1", kind: "module", status: "succeeded", createdAt: "2026-09-01" }]
        : [],
  };
  const builds = fakeModuleBuilder();
  const service = wiredSandbox({
    activities: {
      getActivity: async () => activity,
      isCanonicalRef: () => options.canonical ?? true,
      effectiveModuleDocument: async () => null,
      productOf: () => ({ moduleFolder: FOLDER, canonicalRefNum: 1 }),
      draftWorkspace: () => path.join(wafh, "drafts"),
    },
    generation,
    root: wafh,
    wafRoot: waf,
    builder: builds.builder,
    confinementProblem: options.confinementProblem,
  });
  return { service, root, wafh, waf, moduleRoot, generation, builds };
}

describe("previewing a module from the WAF checkout", () => {
  const roots: string[] = [];
  afterEach(async () => {
    for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
  });
  async function made(options?: Parameters<typeof setup>[0]) {
    const result = await setup(options);
    roots.push(result.root);
    return result;
  }

  it("reports a module for an imported ref whose module exists only in the checkout", async () => {
    const { service, moduleRoot } = await made();
    const record = {
      id: ACTIVITY,
      collectionId: "col",
      productCode: "sight-words",
      refNum: 1,
    } as unknown as Parameters<typeof service.hasModule>[1];
    expect(await service.hasModule(PROJECT, record)).toBe(true);
    // Without the module's definition there is nothing to show as built.
    await fs.rm(path.join(moduleRoot, "definition.json"));
    expect(await service.hasModule(PROJECT, record)).toBe(false);
  });

  it("composes the payload from the checkout when WAF Harness has built nothing", async () => {
    const { service } = await made();
    const payload = await service.payload(PROJECT, ACTIVITY, {});
    expect(payload.id).toBe("preview:sightWords");
    const main = payload.layout.compartments.main as unknown as {
      require: Record<string, { url: string }>;
      assets: Record<string, { url: string }>;
    };
    const base = "/api/projects/proj/activities/act_1/sandbox/";
    expect(main.require.entry!.url).toBe(`${base}module/entry.js`);
    // Media is the media root, not a module file: the token is resolved, never prefixed.
    expect(main.require.font!.url).toBe(`${base}media/fonts/Waterford.css`);
    expect(main.assets.cover!.url).toBe(`${base}media/loom/sight-words/cover.jpg`);
    expect(payload.configuration.sightWords).toEqual({
      intro: { audio: `${base}media/loom/sight-words/intro.mp3` },
    });
  });

  it("hangs every URL off the base a played preview passes", async () => {
    const { service } = await made();
    const payload = await service.payload(PROJECT, ACTIVITY, { base: "/preview/activity/t/" });
    const main = payload.layout.compartments.main as unknown as {
      require: Record<string, { url: string }>;
    };
    expect(main.require.entry!.url).toBe("/preview/activity/t/module/entry.js");
    expect(main.require.font!.url).toBe("/preview/activity/t/media/fonts/Waterford.css");
  });

  it("declares the checkout's navigation bar, in its park theme, as Loom did", async () => {
    const { service, waf } = await made();
    const navbar = path.join(waf, "modules", "navbar");
    await write(path.join(navbar, "definition.json"), {
      id: "Navigation Bar",
      require: {
        entry: { type: "javascript", url: "entry.js" },
        font: { type: "css", url: "{{MEDIA}}/fonts/Dimbo.css" },
      },
      themes: { park: { assets: {}, properties: { theme: "park" } } },
    });
    await write(path.join(navbar, "configurations", "none_navBar.json"), { shown: true });
    const payload = await service.payload(PROJECT, ACTIVITY, { base: "/b/" });
    const compartment = payload.layout.compartments.navBar as unknown as {
      id: string;
      require: Record<string, { url: string }>;
    };
    expect(compartment.id).toBe("Navigation Bar");
    expect(compartment.require.entry!.url).toBe("/b/navbar/entry.js");
    expect(compartment.require.font!.url).toBe("/b/media/fonts/Dimbo.css");
    expect(payload.configuration["Navigation Bar"]).toEqual({ shown: true });
    const served = await service.navbarFile("definition.json");
    expect(JSON.parse(Buffer.from(served.body!).toString("utf8")).id).toBe("Navigation Bar");
  });

  it("prefers the module WAF Harness built over the one in the checkout", async () => {
    const { service } = await made({ runs: true });
    const payload = await service.payload(PROJECT, ACTIVITY, {});
    const main = payload.layout.compartments.main as unknown as {
      properties: Record<string, unknown>;
    };
    expect(main.properties.from).toBe("wafh");
  });

  it("serves the build output first, then res, then the module folder", async () => {
    const { service, wafh } = await made();
    await write(path.join(checkoutOutputRoot(wafh, FOLDER), "entry.js"), "built entry");
    const text = async (file: string) =>
      Buffer.from((await service.moduleFile(PROJECT, ACTIVITY, file)).body!).toString("utf8");
    expect(await text("entry.js")).toBe("built entry");
    expect(await text("layout.html")).toBe("<div>checkout layout</div>");
    expect(JSON.parse(await text("package.json")).version).toBe("1.0.17");
  });

  it("does not serve Loom's authoring files from the module folder", async () => {
    const { service } = await made();
    await expect(
      service.moduleFile(PROJECT, ACTIVITY, "generated/sight-words/spec/notes.json"),
    ).rejects.toThrow("not a module file");
  });

  it("serves the draft's media first and the checkout's when the draft has none", async () => {
    const { service } = await made();
    const body = async (file: string) =>
      Buffer.from((await service.media(PROJECT, ACTIVITY, file, {})).body!).toString("utf8");
    expect(await body("loom/sight-words/intro.mp3")).toBe("draft");
    expect(await body("loom/sight-words/cover.jpg")).toBe("checkout cover");
    await expect(service.media(PROJECT, ACTIVITY, "loom/missing.jpg", {})).rejects.toThrow(
      "No media file",
    );
  });

  it("refuses a media path that climbs out of both roots", async () => {
    const { service } = await made();
    await expect(
      service.media(PROJECT, ACTIVITY, "..%2Fmodules%2Fwaf-module-sight-words%2Fpackage.json", {}),
    ).rejects.toThrow("not a media path");
  });

  it("reports a checkout module as needing a build until its output exists", async () => {
    const { service, wafh } = await made();
    expect((await service.status(PROJECT, ACTIVITY)).state).toBe("stale");
    // Written after the sources, as a build would be.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await write(path.join(checkoutOutputRoot(wafh, FOLDER), "entry.js"), "built");
    expect((await service.status(PROJECT, ACTIVITY)).state).toBe("ready");
  });

  it("lets any ref build a checkout module, into WAF Harness's directory", async () => {
    const { service, moduleRoot, wafh, waf, builds } = await made({ canonical: false });
    const result = await service.build(PROJECT, ACTIVITY, true);
    expect(result.ok).toBe(true);
    expect(builds.checkouts).toEqual([
      {
        moduleRoot,
        outputRoot: checkoutOutputRoot(wafh, FOLDER),
        frameworkRoot: path.join(waf, "framework"),
        moduleId: "sightWords",
        mediaRoot: path.join(waf, "media"),
      },
    ]);
    expect(builds.runs).toEqual([]);
  });

  it("builds a checkout module where nothing could confine a run's build", async () => {
    // A checkout module's build runs the checkout's own code, not a run agent's.
    const { service, builds } = await made({ confinementProblem: "no sandbox backend" });
    expect((await service.build(PROJECT, ACTIVITY, true)).ok).toBe(true);
    expect(builds.checkouts).toHaveLength(1);
  });

  it("never writes to the checkout while reading it", async () => {
    const { service, waf } = await made();
    const before = await fs.readdir(path.join(waf, "modules", FOLDER), { recursive: true });
    await service.payload(PROJECT, ACTIVITY, {});
    await service.status(PROJECT, ACTIVITY);
    await service.moduleFile(PROJECT, ACTIVITY, "layout.html");
    const after = await fs.readdir(path.join(waf, "modules", FOLDER), { recursive: true });
    expect(after.sort()).toEqual(before.sort());
  });
});

describe("the link a played preview is served at", () => {
  it("is the activity's fixed address, the same every time and on every server", () => {
    const key = new ActivityPlayLinksService().link({ projectId: PROJECT, activityId: ACTIVITY });
    expect(key).toBe(playKey({ projectId: PROJECT, activityId: ACTIVITY }));
    expect(readPlayKey(key)).toEqual({ projectId: PROJECT, activityId: ACTIVITY });
  });

  it("names the module run it plays", () => {
    const key = playKey({ projectId: PROJECT, activityId: ACTIVITY, runId: "run_2" });
    expect(readPlayKey(key)).toEqual({ projectId: PROJECT, activityId: ACTIVITY, runId: "run_2" });
  });

  it("reads nothing from a key that is not one", () => {
    for (const key of ["", "only", "a~b~c~d", "a~b/c", "a~~b", "../x~y"])
      expect(readPlayKey(key)).toBeNull();
  });
});

describe("playing a module run before it finishes", () => {
  const roots: string[] = [];
  afterEach(async () => {
    for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
  });

  /** The checkout's module, and a module run's workspace that has not finished. */
  async function made(run: { kind: string; status: string }) {
    const result = await setup();
    roots.push(result.root);
    const runModule = path.join(result.wafh, "activity-runs", "run_2", "module");
    await write(path.join(runModule, "definition.json"), {
      id: "runModule",
      require: { entry: { type: "javascript", url: "entry.js" } },
      themes: { park: { assets: {}, properties: {} } },
    });
    await write(path.join(runModule, "dist", "debug", "entry.js"), "window.fromRun = true;");
    Object.assign(result.generation, {
      run: async (_project: string, _activity: string, runId: string) => {
        if (runId !== "run_2") throw new Error("run_not_found");
        return { runId, ...run };
      },
    });
    return result;
  }

  it("plays the running run a link names, and the checkout without one", async () => {
    const { service } = await made({ kind: "module", status: "running" });
    expect((await service.payload(PROJECT, ACTIVITY, { runId: "run_2" })).id).toBe(
      "preview:runModule",
    );
    const entry = await service.moduleFile(PROJECT, ACTIVITY, "entry.js", "run_2");
    expect(Buffer.from(entry.body!).toString()).toBe("window.fromRun = true;");
    expect((await service.payload(PROJECT, ACTIVITY, {})).id).toBe("preview:sightWords");
  });

  it("counts a run build missing a file its definition requires as unbuilt", async () => {
    // An assembly's own buildDebug copied res/style.scss and left no style.css; a build
    // newer than its sources would otherwise never be redone.
    const { service, wafh } = await made({ kind: "module", status: "running" });
    const root = path.join(wafh, "activity-runs", "run_2", "module");
    const builtAtMs = (source: unknown) =>
      (service as unknown as { builtAtMs(s: unknown): Promise<number | null> }).builtAtMs(source);
    expect(await builtAtMs({ kind: "run", root })).not.toBeNull();
    await write(path.join(root, "definition.json"), {
      id: "runModule",
      require: {
        entry: { type: "javascript", url: "entry.js" },
        style: { type: "css", url: "style.css" },
      },
    });
    expect(await builtAtMs({ kind: "run", root })).toBeNull();
    await write(path.join(root, "dist", "debug", "style.css"), "body{}");
    expect(await builtAtMs({ kind: "run", root })).not.toBeNull();
  });

  it("plays no run that failed, is not an assembly, or does not exist", async () => {
    for (const run of [
      { kind: "module", status: "failed" },
      { kind: "spec", status: "running" },
    ]) {
      const { service } = await made(run);
      await expect(service.payload(PROJECT, ACTIVITY, { runId: "run_2" })).rejects.toMatchObject({
        code: "preview_not_built",
      });
    }
    const { service } = await made({ kind: "module", status: "running" });
    await expect(service.payload(PROJECT, ACTIVITY, { runId: "run_9" })).rejects.toMatchObject({
      code: "preview_not_built",
    });
  });
});

describe("the shared media a module's definition loads", () => {
  it("names the folder of every {{MEDIA}} url, once, and nothing else", () => {
    expect(
      definitionMediaFolders({
        require: {
          entry: { url: "entry.js" },
          font: { url: "{{MEDIA}}/fonts/DimboRegular/DimboRegular.css" },
        },
        themes: {
          standard: {
            assets: {
              help: { url: "{{MEDIA}}/images/navBar/standard/help.svg" },
              pause: { url: "{{MEDIA}}/images/navBar/standard/pause.svg" },
              audio: [{ url: "{{MEDIA}}/audio/english/shared/go_on.mp3" }],
            },
          },
        },
        remote: "https://example.org/{{MEDIA}}/x/y.png",
        topLevel: "{{MEDIA}}/loose.png",
        escape: "{{MEDIA}}/../secrets/key.pem",
      }),
    ).toEqual(["audio/english/shared", "fonts/DimboRegular", "images/navBar/standard"]);
    expect(definitionMediaFolders(null)).toEqual([]);
  });
});
