/**
 * Reading and editing a ref's `spec/state-machine.json` through the API, on a real Loom ref
 * (r1lt19L-v2 ref 1, copied whole): read with its problems, saved only when valid and under
 * the draft's revision, written to the module's file in Loom's shape, reported stale when the
 * specification changes, carried into the next assembly, and discarded back to the exact file
 * and revision it replaced.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ActivityDetail, ActivityDraft } from "../src/activities/domain.js";
import type { ClaimModuleProductResponse } from "../src/activities/module-product-types.js";
import type {
  StateMachineCheck,
  StateMachineDocument,
} from "../src/activities/state-machine-types.js";
import { STATE_MACHINE_CONFIGURATION_KEY } from "../src/activities/state-machine-configuration.js";
import { scaffoldModule } from "../src/activities/waf-module.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";

const FOLDER = "waf-module-r1lt19L-v2";
const PRODUCT = "r1lt19L-v2";
const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "loom-state-machine",
  FOLDER,
);
const FILE = `generated/${PRODUCT}/refs/${PRODUCT}-1/spec/state-machine.json`;

type Machine = Record<string, unknown> & { states: Record<string, Record<string, unknown>> };

describe("state machine edits", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function open() {
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    const module = path.join(t.root, "waf-checkout", "modules", FOLDER);
    await fs.cp(FIXTURE, module, { recursive: true });
    const owner = await provisionUser(t.app, "machine");
    const api = apiClient(t.app, owner.cookie);
    const project = await api.post("/api/projects", { projectId: "machine-work" });
    expect(project.status, await project.clone().text()).toBe(201);
    const base = "/api/projects/machine-work/activities";
    const claimed = await api.post(`${base}/module-products/claim`, {
      moduleFolder: FOLDER,
      productCode: PRODUCT,
    });
    expect(claimed.status, await claimed.clone().text()).toBe(200);
    const id = ((await claimed.json()) as ClaimModuleProductResponse).activityIds[0]!;
    const file = path.join(module, FILE);
    const original = await fs.readFile(file, "utf8");
    const detail = async () => (await (await api.get(`${base}/${id}`)).json()) as ActivityDetail;
    const read = async () => {
      const response = await api.get(`${base}/${id}/state-machine`);
      expect(response.status, await response.clone().text()).toBe(200);
      return (await response.json()) as StateMachineDocument;
    };
    const put = (definition: unknown, expectedRevision: string) =>
      api.put(`${base}/${id}/state-machine`, { definition, expectedRevision });
    const discard = (expectedRevision: string) =>
      api.post(`${base}/${id}/state-machine/discard`, { expectedRevision });
    return { t, api, base, id, file, original, detail, read, put, discard };
  }

  /** The real machine with one scene's description changed: a valid edit. */
  const describeIntro = (machine: unknown, text: string): Machine => {
    const edited = structuredClone(machine) as Machine;
    edited.states["scene-1"]!.description = text;
    return edited;
  };

  it("reads the ref's own machine from the module, with the problems it has", async () => {
    const { read, original } = await open();
    const document = await read();
    expect(document).toMatchObject({
      productCode: PRODUCT,
      refNum: 1,
      source: "ref",
      file: FILE,
      edited: false,
      stale: false,
      editable: true,
      locked: null,
    });
    expect(document.definition).toEqual(JSON.parse(original));
    // Loom wrote it before Loom required `activity` to start at `complete`.
    expect(document.validation).toEqual({
      valid: false,
      issues: [expect.objectContaining({ code: "activity.initial" })],
    });
  });

  it("saves a valid edit into the draft and the module's file, and discards it back exactly", async () => {
    const { read, put, discard, detail, file, original } = await open();
    const before = (await detail()).draft;
    const edit = describeIntro(JSON.parse(original), "Scene 1, edited in Penguin.");

    const saved = await put(edit, before.contentRevision);
    expect(saved.status, await saved.clone().text()).toBe(200);
    const draft = (await saved.json()) as ActivityDraft;
    // A new revision, so what was built from the old one reads as out of date.
    expect(draft.contentRevision).not.toBe(before.contentRevision);
    expect(draft.moduleDocuments?.stateMachine?.value).toEqual(edit);
    // Loom's file, in Loom's place, holds the edit.
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual(edit);
    expect(await read()).toMatchObject({
      source: "draft",
      edited: true,
      stale: false,
      definition: edit,
    });

    // Saving again keeps what the file held before the first edit, for the discard.
    const again = await put(describeIntro(edit, "Twice."), draft.contentRevision);
    expect(again.status, await again.clone().text()).toBe(200);
    const twice = (await again.json()) as ActivityDraft;

    const discarded = await discard(twice.contentRevision);
    expect(discarded.status, await discarded.clone().text()).toBe(200);
    expect(((await discarded.json()) as ActivityDraft).contentRevision).toBe(
      before.contentRevision,
    );
    expect(await fs.readFile(file, "utf8")).toBe(original);
    expect(await read()).toMatchObject({ source: "ref", edited: false });
  });

  it("refuses an invalid machine with a 400 naming its problems, and changes nothing", async () => {
    const { put, detail, file, original } = await open();
    const before = (await detail()).draft;
    const broken = describeIntro(JSON.parse(original), "Broken.");
    broken.states["scene-1"]!.initial = "nowhere";
    broken.states["scene-13"] = {};

    const refused = await put(broken, before.contentRevision);
    expect(refused.status).toBe(400);
    const body = (await refused.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("state_machine_invalid");
    expect(body.error.message).toContain('State "scene-1" has unknown initial child "nowhere".');
    expect(body.error.message).toContain('unknown scene state "scene-13"');
    // The problem the machine already had is not the author's to fix first.
    expect(body.error.message).not.toContain("complete");
    expect((await detail()).draft.contentRevision).toBe(before.contentRevision);
    expect(await fs.readFile(file, "utf8")).toBe(original);

    const notObject = await put([], before.contentRevision);
    expect(notObject.status).toBe(400);
    expect(await notObject.json()).toMatchObject({ error: { code: "bad_request" } });
  });

  it("checks an unsaved machine, marking what the saved one already had", async () => {
    const { api, base, id, original } = await open();
    const edited = describeIntro(JSON.parse(original), "Checked.");
    edited.states["scene-13"] = {};
    const response = await api.post(`${base}/${id}/state-machine/check`, { definition: edited });
    expect(response.status, await response.clone().text()).toBe(200);
    const check = (await response.json()) as StateMachineCheck;
    expect(check).toMatchObject({ valid: false, savable: false });
    expect(check.issues.map((issue) => [issue.code, issue.inherited])).toEqual([
      ["scene.unknown", false],
      ["activity.initial", true],
    ]);
  });

  it("saves only against the draft's current revision", async () => {
    const { put, detail, original } = await open();
    const before = (await detail()).draft;
    const first = await put(describeIntro(JSON.parse(original), "First."), before.contentRevision);
    expect(first.status).toBe(200);
    const late = await put(describeIntro(JSON.parse(original), "Late."), before.contentRevision);
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ error: { code: "draft_conflict" } });
  });

  it("reports the edit stale when the specification it names the scenes of changes", async () => {
    const { api, base, id, put, read, detail, original } = await open();
    const before = (await detail()).draft;
    const saved = (await (
      await put(describeIntro(JSON.parse(original), "Edited."), before.contentRevision)
    ).json()) as ActivityDraft;
    const spec = structuredClone(saved.spec) as { scenes: { description: string }[] };
    spec.scenes[0]!.description = "A new first scene.";
    const respecced = await api.post(`${base}/${id}/apply-generated-spec`, {
      spec,
      expectedRevision: saved.contentRevision,
    });
    expect(respecced.status, await respecced.clone().text()).toBe(200);
    expect(await read()).toMatchObject({ edited: true, stale: true });
  });

  it("assembles the edited machine, and syncs it into the configuration the player boots from", async () => {
    const { put, detail, original } = await open();
    const edit = describeIntro(JSON.parse(original), "Assembled.");
    expect((await put(edit, (await detail()).draft.contentRevision)).status).toBe(200);
    const files = scaffoldModule(await detail());
    expect(JSON.parse(files[FILE]!)).toEqual(edit);
    const configuration = JSON.parse(files[`configurations/${PRODUCT}-1.json`]!) as Record<
      string,
      Record<string, unknown>
    >;
    expect(configuration[PRODUCT]![STATE_MACHINE_CONFIGURATION_KEY]).toEqual(edit);
  });

  it("keeps a book's reader machine out of reach", async () => {
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "book");
    const api = apiClient(t.app, owner.cookie);
    expect((await api.post("/api/projects", { projectId: "book-work" })).status).toBe(201);
    const base = "/api/projects/book-work/activities";
    const created = await api.post(base, {
      productCode: "zz-book-machine",
      refNum: 1,
      title: "A book",
      activityType: "book",
      bookMode: "readAlong",
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const book = (await created.json()) as ActivityDetail;
    const read = await api.get(`${base}/${book.id}/state-machine`);
    expect(await read.json()).toMatchObject({ editable: false, locked: "book", source: null });
    const refused = await api.put(`${base}/${book.id}/state-machine`, {
      definition: { version: "1.1", id: "book", initial: "a", states: { a: {} } },
      expectedRevision: book.draft.contentRevision,
    });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "book_state_machine" } });
  });
});
