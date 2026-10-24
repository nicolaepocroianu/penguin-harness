/**
 * Products Loom authored in the modules, opened in place as Loom opens them: the Activities
 * list holds every product the modules hold, and opening a ref reads Loom's files as they
 * are, writing nothing to the module or the media repository. The first change to a ref
 * writes Loom's own files and nothing beside them; WAF Harness's bookkeeping is the index's.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ActivityDetail, ActivityDraft, ActivityRecord } from "../src/activities/domain.js";
import { activitySpec, refFilesDir, refState, treeSnapshot } from "./activity-fixtures.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";

const FOLDER = "waf-module-sight-words";
const CODE = "sight-words";

async function write(file: string, content: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, typeof content === "string" ? content : JSON.stringify(content));
}

/** A product Loom authored: a canonical, template-stable ref 1 with an image bound in media. */
async function loomProduct(root: string) {
  const product = path.join(root, "waf-checkout", "modules", FOLDER, "generated", CODE);
  await write(path.join(product, "spec", "activity_metadata.json"), {
    id: CODE,
    title: "Sight Words",
    moduleFolder: FOLDER,
    activityType: "standard",
    canonicalRefNum: 1,
    templateStable: true,
  });
  const ref = path.join(product, "refs", `${CODE}-1`, "spec");
  // Loom wrote an old spelling of the folder into this spec; the folder on disk wins.
  await write(path.join(ref, "activity_spec.json"), {
    ...activitySpec,
    moduleFolder: "wafmodule-sight-words",
    scenes: [
      {
        id: "intro",
        description: "Choose a word",
        media: { images: [{ key: "cover", description: "A cat on a mat" }] },
      },
    ],
  });
  await write(path.join(ref, "asset_manifest.json"), {
    productCode: CODE,
    refNum: 1,
    displayName: "Ref 1",
    assets: {
      "en-US": [
        {
          key: "cover",
          type: "image",
          description: "A cat on a mat",
          path: "media/loom/sight-words/sight-words-1/images/english/cover.png",
        },
      ],
    },
  });
  await write(path.join(ref, "activity_description.txt"), "Pick the word you hear.\n");
  await write(path.join(ref, "activity_metadata.json"), {
    id: CODE,
    refNum: 1,
    displayName: "The cat",
  });
}

describe("products in the modules, opened in place", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function setup() {
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    await loomProduct(t.root);
    const client = async (user: string, projectId: string) => {
      const owner = await provisionUser(t.app, user);
      const api = apiClient(t.app, owner.cookie);
      expect((await api.post("/api/projects", { projectId })).status).toBe(201);
      const base = `/api/projects/${projectId}/activities`;
      const list = async () =>
        ((await (await api.get(base)).json()) as { activities: ActivityRecord[] }).activities;
      return { api, base, list };
    };
    const checkout = path.join(t.root, "waf-checkout");
    return { t, client, checkout };
  }

  it("lists a Loom product's refs and opens one without writing to the checkout", async () => {
    const { t, client, checkout } = await setup();
    const { api, base, list } = await client("opener", "opener-work");
    const before = await treeSnapshot(checkout);

    const listed = await list();
    expect(listed).toEqual([
      expect.objectContaining({ productCode: CODE, refNum: 1, displayName: "The cat" }),
    ]);
    const opened = (await (await api.get(`${base}/${listed[0]!.id}`)).json()) as ActivityDetail;
    expect(opened).toMatchObject({ refNum: 1, displayName: "The cat", stable: true });
    expect(opened.draft.status).toBe("valid");
    expect(opened.draft.description).toBe("Pick the word you hear.\n");
    expect(opened.draft.spec).toMatchObject({ moduleFolder: FOLDER, title: activitySpec.title });
    // Loom's binding is carried onto the plan WAF Harness makes from the specification.
    expect(opened.draft.mediaPlan!.manifest.assets["en-US"]).toEqual([
      expect.objectContaining({
        key: "cover",
        path: "media/loom/sight-words/sight-words-1/images/english/cover.png",
      }),
    ]);
    // Read again, it is the same draft.
    const again = (await (await api.get(`${base}/${listed[0]!.id}`)).json()) as ActivityDetail;
    expect(again.draft.contentRevision).toBe(opened.draft.contentRevision);
    // Not a byte of the module or the media repository changed, and no bookkeeping was made.
    expect(await treeSnapshot(checkout)).toEqual(before);
    expect(refState(t.deps.db, opened.id)).toBeNull();
  });

  it("writes only Loom's own files on the first change, and keeps it", async () => {
    const { t, client } = await setup();
    const { api, base, list } = await client("saver", "saver-work");
    const [{ id }] = (await list()) as [ActivityRecord];
    const opened = (await (await api.get(`${base}/${id}`)).json()) as ActivityDetail;
    const described = await api.patch(`${base}/${id}/description`, {
      description: "Pick the word you hear, then say it.\n",
      expectedRevision: opened.draft.contentRevision,
    });
    expect(described.status, await described.clone().text()).toBe(200);
    const saved = (await described.json()) as ActivityDraft;

    const files = refFilesDir(t.root, CODE, 1);
    expect((await fs.readdir(files)).sort()).toEqual([
      "activity_description.txt",
      "activity_metadata.json",
      "activity_spec.json",
      "asset_manifest.json",
    ]);
    const product = path.join(t.root, "waf-checkout", "modules", FOLDER, "generated", CODE);
    expect(await fs.readdir(path.join(product, "spec"))).toEqual(["activity_metadata.json"]);
    expect(await fs.readFile(path.join(files, "activity_description.txt"), "utf8")).toBe(
      "Pick the word you hear, then say it.\n",
    );
    // The specification carries the folder on disk; Loom's manifest keeps what it had.
    expect(
      JSON.parse(await fs.readFile(path.join(files, "activity_spec.json"), "utf8")),
    ).toMatchObject({ moduleFolder: FOLDER });
    expect(
      JSON.parse(await fs.readFile(path.join(files, "asset_manifest.json"), "utf8")),
    ).toMatchObject({ displayName: "Ref 1" });
    // The bookkeeping is the index's, and the draft reads back as it was saved.
    expect(refState(t.deps.db, id)).toMatchObject({
      activityId: id,
      contentRevision: saved.contentRevision,
      // A new script leaves the specification to be checked again, as any script edit does.
      status: "draft",
    });
    const reread = (await (await api.get(`${base}/${id}`)).json()) as ActivityDetail;
    expect(reread.draft).toMatchObject({
      contentRevision: saved.contentRevision,
      status: "draft",
      description: "Pick the word you hear, then say it.\n",
    });
    expect(reread.draft.mediaPlan!.manifest).toEqual(opened.draft.mediaPlan!.manifest);
  });

  it("reads a ref an earlier build saved with its wafh.json, and leaves the file", async () => {
    const { t, client } = await setup();
    const files = refFilesDir(t.root, CODE, 1);
    const legacy = {
      schemaVersion: 1,
      draftId: "draft_0123456789abcdef0123456789abcdef",
      activityId: "act_0123456789abcdef0123456789abcdef",
      baseVersionId: null,
      contentRevision: "0".repeat(64),
      status: "draft",
      noSpec: true,
      updatedAt: "2026-10-01T00:00:00.000Z",
    };
    await write(path.join(files, "wafh.json"), legacy);
    const { api, base, list } = await client("keeper", "keeper-work");
    const listed = await list();
    // The ids its bookkeeping names are kept.
    expect(listed.map((activity) => activity.id)).toEqual([legacy.activityId]);
    const opened = (await (await api.get(`${base}/${legacy.activityId}`)).json()) as ActivityDetail;
    expect(opened.draft).toMatchObject({
      draftId: legacy.draftId,
      spec: null,
      description: "Pick the word you hear.\n",
    });
    expect(refState(t.deps.db, legacy.activityId)).toMatchObject({ draftId: legacy.draftId });
    expect(JSON.parse(await fs.readFile(path.join(files, "wafh.json"), "utf8"))).toEqual(legacy);
  });

  it("lists a ref added to the module since, and not one deleted here", async () => {
    const { t, client } = await setup();
    const { api, base, list } = await client("adder", "adder-work");
    expect(await list()).toHaveLength(1);
    const refs = path.join(t.root, "waf-checkout", "modules", FOLDER, "generated", CODE, "refs");
    await fs.cp(path.join(refs, `${CODE}-1`), path.join(refs, `${CODE}-2`), { recursive: true });
    await write(path.join(refs, `${CODE}-2`, "spec", "activity_metadata.json"), {
      id: CODE,
      refNum: 2,
    });
    const both = await list();
    expect(both.map((activity) => activity.refNum)).toEqual([1, 2]);
    const added = both.find((activity) => activity.refNum === 2)!;
    expect((await api.delete(`${base}/${added.id}`)).status).toBe(204);
    expect((await list()).map((activity) => activity.refNum)).toEqual([1]);
  });

  it("keeps a product another project lists first from this project's list", async () => {
    const { client } = await setup();
    const first = await client("first", "first-work");
    expect(await first.list()).toHaveLength(1);
    const second = await client("second", "second-work");
    expect(await second.list()).toEqual([]);
  });
});
