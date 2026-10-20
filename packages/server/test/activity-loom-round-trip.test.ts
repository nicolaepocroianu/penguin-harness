/**
 * Opening and saving a product Loom authored keeps everything Loom wrote in its own files.
 *
 * The fixtures are trimmed copies of two real products: the read-along book m2ab01 from the
 * waf-modules monorepo (book roles, image labels, segment timings, Loom-keyed word
 * pronunciations) and ref 150 of the decodable r2pt01 (voices, Loom's word bookkeeping, an
 * image only a scene's own fields name, and product metadata with template stability and a
 * deployment). Each is opened, saved, and its files compared with what Loom wrote.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ActivityDetail, ActivityDraft } from "../src/activities/domain.js";
import type { ClaimModuleProductResponse } from "../src/activities/module-product-types.js";
import { loomGenerationFingerprint } from "../src/activities/ref-media.js";
import { ELEVENLABS_DEFAULT_VOICE, SPEECH_MODEL } from "../src/activities/voice-catalogue.js";
import { activitySpec, refFilesDir } from "./activity-fixtures.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "loom-round-trip",
);

type Json = Record<string, unknown>;
type Asset = Json & { key: string };

async function readJson(file: string): Promise<Json> {
  return JSON.parse(await fs.readFile(file, "utf8")) as Json;
}

const assetsOf = (manifest: Json) =>
  Object.values(manifest["assets"] as Record<string, Asset[]>).flat();

describe("a Loom product opened and saved in Penguin", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function open(folder: string, code: string, projectId: string) {
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    const modules = path.join(t.root, "waf-checkout", "modules");
    await fs.cp(path.join(FIXTURES, folder), path.join(modules, folder), { recursive: true });
    const owner = await provisionUser(t.app, projectId.split("-")[0]!);
    const api = apiClient(t.app, owner.cookie);
    expect((await api.post("/api/projects", { projectId })).status).toBe(201);
    const base = `/api/projects/${projectId}/activities`;
    const claimed = await api.post(`${base}/module-products/claim`, {
      moduleFolder: folder,
      productCode: code,
    });
    expect(claimed.status, await claimed.clone().text()).toBe(200);
    const result = (await claimed.json()) as ClaimModuleProductResponse;
    // The trimmed fixtures leave out Loom's state machines, which is noted and nothing more.
    expect(result.problems.filter((problem) => !problem.includes("state machine"))).toEqual([]);
    expect(result.activityIds).toHaveLength(1);
    const id = result.activityIds[0]!;
    const detail = async () => (await (await api.get(`${base}/${id}`)).json()) as ActivityDetail;
    // Saving: the media plan sent back as the author has it, and the description edited.
    const save = async () => {
      const before = await detail();
      const media = await api.put(`${base}/${id}/media`, {
        manifest: before.draft.mediaPlan!.manifest,
        expectedRevision: before.draft.contentRevision,
      });
      expect(media.status, await media.clone().text()).toBe(200);
      const saved = (await media.json()) as ActivityDraft;
      const described = await api.patch(`${base}/${id}/description`, {
        description: `${before.draft.description}Saved in Penguin.\n`,
        expectedRevision: saved.contentRevision,
      });
      expect(described.status, await described.clone().text()).toBe(200);
      // What Penguin reads back is what it saved: Loom's extras never reach its manifest.
      expect((await detail()).draft.mediaPlan!.manifest).toEqual(before.draft.mediaPlan!.manifest);
    };
    const product = path.join(modules, folder, "generated", code);
    return {
      t,
      api,
      base,
      id,
      detail,
      save,
      product,
      source: path.join(FIXTURES, folder, "generated", code),
    };
  }

  /** Every asset Loom wrote is in the manifest, every field as Loom had it, but `except`. */
  async function expectLoomAssetsKept(
    original: string,
    written: string,
    except: (asset: Asset, field: string) => boolean = () => false,
  ) {
    const before = assetsOf(await readJson(original));
    const after = new Map(assetsOf(await readJson(written)).map((asset) => [asset.key, asset]));
    for (const asset of before) {
      const kept = after.get(asset.key);
      expect(kept, asset.key).toBeDefined();
      for (const [field, value] of Object.entries(asset))
        if (!except(asset, field)) expect(kept![field], `${asset.key}.${field}`).toEqual(value);
    }
  }

  it("keeps a read-along book's roles, labels, timings and word keys (m2ab01)", async () => {
    const { save, detail, product, source, t } = await open(
      "waf-module-m2ab01",
      "m2ab01",
      "book-work",
    );
    const spec = refFilesDir(t.root, "m2ab01", 1, "waf-module-m2ab01");
    const original = path.join(source, "refs", "m2ab01-1", "spec", "asset_manifest.json");
    const check = async () => {
      await expectLoomAssetsKept(original, path.join(spec, "asset_manifest.json"));
      const manifest = await readJson(path.join(spec, "asset_manifest.json"));
      const roles = assetsOf(manifest).map((asset) => asset["role"]);
      expect(roles).toEqual(expect.arrayContaining(["bookIntro", "bookPageTurn", "bookWord"]));
      expect(await readJson(path.join(product, "spec", "activity_metadata.json"))).toMatchObject({
        tags: ["Waterford Books", "Imported"],
        templateStable: false,
        runtime: { engine: "html", theme: "park" },
        bookMode: "readAlong",
      });
      expect(await readJson(path.join(spec, "activity_metadata.json"))).toMatchObject({
        displayName: "Milton's Milttens",
        templateStable: false,
        tags: ["Waterford Books", "Imported"],
      });
    };
    await check();
    // Penguin reads only what it holds: no book roles, no Loom-only fields.
    const opened = await detail();
    expect(opened.draft.status).toBe("valid");
    const mine = opened.draft.mediaPlan!.manifest.assets["en-US"]!;
    expect(mine.some((asset) => "imageLabels" in asset || "segmentTimings" in asset)).toBe(false);
    expect(mine.map((asset) => asset.key)).not.toContain("book-intro-video");
    // Loom's word keys are what the module's configuration names; they stay.
    expect(mine.map((asset) => asset.key)).toContain("word-cf04119a706e2c45");
    expect(opened.tags).toEqual(["Waterford Books", "Imported"]);
    await save();
    await check();
  });

  it("keeps a decodable ref's voices, word bookkeeping, unplanned image and product metadata (r2pt01)", async () => {
    const { api, base, id, save, detail, product, source, t } = await open(
      "waf-module-r2pt01",
      "r2pt01",
      "deco-work",
    );
    const spec = refFilesDir(t.root, "r2pt01", 150, "waf-module-r2pt01");
    const original = path.join(source, "refs", "r2pt01-150", "spec", "asset_manifest.json");
    // Penguin keeps a word's recording timings only when they align with its script, and
    // says so when it drops them; these are phoneme timings for a drawn-out script.
    const timingsOfWords = (asset: Asset, field: string) =>
      asset["role"] === "bookWord" && field === "wordTimings";
    const check = async () => {
      await expectLoomAssetsKept(original, path.join(spec, "asset_manifest.json"), timingsOfWords);
      expect(await readJson(path.join(product, "spec", "activity_metadata.json"))).toMatchObject({
        tags: ["Decodables"],
        templateStable: true,
        runtime: { engine: "html", usesAssessment: false },
        deploymentName: "r2pt01-module-150",
        deploymentSource: "legacy",
        canonicalRefNum: 150,
      });
    };
    await check();
    const opened = await detail();
    expect(opened.draft.status).toBe("valid");
    const mine = opened.draft.mediaPlan!.manifest.assets["en-US"]!;
    expect(mine.find((asset) => asset.key === "scene-1-audio-reading-directions")?.voice).toBe(
      "ehiTRHLcT9mKtdi7oaju",
    );
    expect(mine.map((asset) => asset.key)).toContain("scene-4-image-magnifier-inset");
    await save();
    await check();
    // Tags edited in Penguin replace Loom's; the rest of the product's metadata stays.
    const tagged = await api.put(`${base}/${id}/tags`, { tags: ["Decodables", "Ants"] });
    expect(tagged.status, await tagged.clone().text()).toBe(200);
    expect(await readJson(path.join(product, "spec", "activity_metadata.json"))).toMatchObject({
      tags: ["Decodables", "Ants"],
      templateStable: true,
      deploymentName: "r2pt01-module-150",
    });
  });
});

describe("a ref made in Penguin, as Loom lists refs", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("has a spec, a manifest and a module configuration, and configuration edits reach the module", async () => {
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "maker");
    const api = apiClient(t.app, owner.cookie);
    expect((await api.post("/api/projects", { projectId: "maker-work" })).status).toBe(201);
    const base = "/api/projects/maker-work/activities";
    const created = await api.post(base, { productCode: "fresh", refNum: 1, title: "Fresh" });
    expect(created.status, await created.clone().text()).toBe(201);
    const activity = (await created.json()) as ActivityDetail;
    const spec = refFilesDir(t.root, "fresh", 1);
    expect(await readJson(path.join(spec, "activity_spec.json"))).toEqual({});
    expect(await readJson(path.join(spec, "asset_manifest.json"))).toEqual({
      productCode: "fresh",
      refNum: 1,
      assets: { "en-US": [] },
    });
    await fs.access(path.join(spec, "activity_description.txt"));
    await fs.access(path.join(spec, "activity_metadata.json"));
    const configuration = path.join(
      t.root,
      "waf-checkout",
      "modules",
      "waf-module-fresh",
      "configurations",
      "fresh-1.json",
    );
    expect(await readJson(configuration)).toEqual({});
    // The draft still has no specification, whatever the stub says.
    const reread = (await (await api.get(`${base}/${activity.id}`)).json()) as ActivityDetail;
    expect(reread.draft.spec).toBeNull();

    const edited = await api.put(`${base}/${activity.id}/module-documents/configuration`, {
      value: { greeting: "hello" },
      expectedRevision: activity.draft.contentRevision,
    });
    expect(edited.status, await edited.clone().text()).toBe(200);
    expect(await readJson(configuration)).toEqual({ greeting: "hello" });
    const draft = (await edited.json()) as ActivityDraft;
    const discarded = await api.post(
      `${base}/${activity.id}/module-documents/configuration/discard`,
      {
        expectedRevision: draft.contentRevision,
      },
    );
    expect(discarded.status, await discarded.clone().text()).toBe(200);
    expect(await readJson(configuration)).toEqual({});
  });
});

describe("a configuration edit, in the module's own file", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function fresh() {
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "editor");
    const api = apiClient(t.app, owner.cookie);
    expect((await api.post("/api/projects", { projectId: "editor-work" })).status).toBe(201);
    const base = "/api/projects/editor-work/activities";
    const created = await api.post(base, { productCode: "edits", refNum: 1, title: "Edits" });
    expect(created.status, await created.clone().text()).toBe(201);
    const { id } = (await created.json()) as ActivityDetail;
    const file = path.join(
      t.root,
      "waf-checkout",
      "modules",
      "waf-module-edits",
      "configurations",
      "edits-1.json",
    );
    const revision = async () =>
      ((await (await api.get(`${base}/${id}`)).json()) as ActivityDetail).draft.contentRevision;
    const put = (value: unknown, expectedRevision: string) =>
      api.put(`${base}/${id}/module-documents/configuration`, { value, expectedRevision });
    const discard = async () => {
      const response = await api.post(`${base}/${id}/module-documents/configuration/discard`, {
        expectedRevision: await revision(),
      });
      expect(response.status, await response.clone().text()).toBe(200);
    };
    return {
      t,
      file,
      revision,
      put,
      discard,
      penguin: path.join(refFilesDir(t.root, "edits", 1), "penguin.json"),
    };
  }

  it("puts back the module's file on a discard of an edit made before edits were written there", async () => {
    const { file, revision, put, discard, penguin } = await fresh();
    expect((await put({ a: 1 }, await revision())).status).toBe(200);
    // As an edit saved before this change left things: no record of the module's file, which
    // still holds what Loom wrote.
    const state = JSON.parse(await fs.readFile(penguin, "utf8")) as {
      moduleDocuments: { configuration: Record<string, unknown> };
    };
    delete state.moduleDocuments.configuration["replaced"];
    await fs.writeFile(penguin, JSON.stringify(state));
    await fs.writeFile(file, '{ "loom": true }');
    expect((await put({ a: 2 }, await revision())).status).toBe(200);
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({ a: 2 });
    await discard();
    expect(await fs.readFile(file, "utf8")).toBe('{ "loom": true }');
  });

  it("never deletes a file it could not read, and puts it back as it was", async () => {
    const { file, revision, put, discard } = await fresh();
    await fs.writeFile(file, "not json {");
    expect((await put({ a: 1 }, await revision())).status).toBe(200);
    await discard();
    expect(await fs.readFile(file, "utf8")).toBe("not json {");
  });

  it("leaves the file holding the edit the draft holds when two arrive at once", async () => {
    const { file, revision, put, penguin } = await fresh();
    const expected = await revision();
    const answers = await Promise.all([put({ a: 1 }, expected), put({ a: 2 }, expected)]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
    const state = JSON.parse(await fs.readFile(penguin, "utf8")) as {
      moduleDocuments: { configuration: { value: unknown } };
    };
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual(
      state.moduleDocuments.configuration.value,
    );
  });
});

describe("metadata Penguin writes over Loom's", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("keeps Loom's tags exactly as Loom wrote them, beyond Penguin's own limits", async () => {
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    const folder = "waf-module-r2pt01";
    const modules = path.join(t.root, "waf-checkout", "modules");
    await fs.cp(path.join(FIXTURES, folder), path.join(modules, folder), { recursive: true });
    const metadata = path.join(
      modules,
      folder,
      "generated",
      "r2pt01",
      "spec",
      "activity_metadata.json",
    );
    const loomTags = [
      ...Array.from({ length: 21 }, (_, at) => `Tag ${at + 1}`),
      "A tag far longer than Penguin's thirty-two characters",
      "Bell\u0007",
    ];
    await fs.writeFile(metadata, JSON.stringify({ ...(await readJson(metadata)), tags: loomTags }));
    const owner = await provisionUser(t.app, "tagger");
    const api = apiClient(t.app, owner.cookie);
    expect((await api.post("/api/projects", { projectId: "tagger-work" })).status).toBe(201);
    const base = "/api/projects/tagger-work/activities";
    const claimed = await api.post(`${base}/module-products/claim`, {
      moduleFolder: folder,
      productCode: "r2pt01",
    });
    expect(claimed.status, await claimed.clone().text()).toBe(200);
    expect((await readJson(metadata))["tags"]).toEqual(loomTags);
    // Penguin keeps the ones it can, within its limits.
    const id = ((await claimed.json()) as ClaimModuleProductResponse).activityIds[0]!;
    const opened = (await (await api.get(`${base}/${id}`)).json()) as ActivityDetail;
    expect(opened.tags).toEqual(loomTags.slice(0, 20));
    // An author's own tags replace them.
    expect((await api.put(`${base}/${id}/tags`, { tags: ["Ants"] })).status).toBe(200);
    expect((await readJson(metadata))["tags"]).toEqual(["Ants"]);
  });

  it("removes the ref's runtime when Penguin's specification goes", async () => {
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "clearer");
    const api = apiClient(t.app, owner.cookie);
    expect((await api.post("/api/projects", { projectId: "clearer-work" })).status).toBe(201);
    const base = "/api/projects/clearer-work/activities";
    const created = (await (
      await api.post(base, { productCode: "plain", refNum: 1, title: "Plain" })
    ).json()) as ActivityDetail;
    const endpoint = `${base}/${created.id}`;
    const empty = (await (await api.post(`${endpoint}/versions`, {})).json()) as {
      version: { versionId: string };
    };
    const specified = await api.post(`${endpoint}/apply-generated-spec`, {
      spec: { ...activitySpec, id: "plain", moduleFolder: "waf-module-plain" },
      expectedRevision: created.draft.contentRevision,
    });
    expect(specified.status, await specified.clone().text()).toBe(200);
    const metadata = path.join(refFilesDir(t.root, "plain", 1), "activity_metadata.json");
    expect(await readJson(metadata)).toHaveProperty("runtime");
    const restored = await api.post(`${endpoint}/versions/${empty.version.versionId}/restore`, {
      expectedRevision: ((await specified.json()) as ActivityDraft).contentRevision,
    });
    expect(restored.status, await restored.clone().text()).toBe(200);
    expect(await readJson(metadata)).not.toHaveProperty("runtime");
  });
});

describe("Loom's generation fingerprint", () => {
  it("is the one Loom wrote for an ElevenLabs narration", () => {
    // From media/loom/r2pt01/r2pt01-150/audios/english/scene-1-audio-reading-directions.json.
    expect(
      loomGenerationFingerprint({
        provider: "elevenlabs",
        model: "eleven_v4",
        voice: "ehiTRHLcT9mKtdi7oaju",
      }),
    ).toBe("36d7d691d6c404a141614324417cde24a5dd4e0584a60affdb27f6e32ac4031d");
  });

  it("follows Loom's Gemini identity, with the model Penguin actually spoke with", () => {
    // Loom compares this with what its own configured model would give; Penguin's Gemini model
    // differs, so Loom makes the clip again, as it should for another model's recording.
    expect(
      loomGenerationFingerprint({ provider: "gemini", model: SPEECH_MODEL, voice: "Kore" }),
    ).toBe("f628cd754cd1708f7f37040bc18c552f979f8aba45264740d651c43c8e644e33");
  });

  it("is absent where Penguin cannot say what Loom would compute", () => {
    // The default ElevenLabs voice before it is resolved to the voice id that spoke the clip.
    expect(
      loomGenerationFingerprint({
        provider: "elevenlabs",
        model: "eleven_v4",
        voice: ELEVENLABS_DEFAULT_VOICE,
      }),
    ).toBeNull();
    expect(
      loomGenerationFingerprint({ provider: "gemini", model: "m", voice: "default" }),
    ).toBeNull();
    expect(
      loomGenerationFingerprint({ provider: "kokoro", model: "m", voice: "af_heart" }),
    ).toBeNull();
  });
});
