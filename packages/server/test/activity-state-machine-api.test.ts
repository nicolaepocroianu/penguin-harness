/**
 * Reading and editing a product's `spec/state-machine.json` through the API, as Loom's GET and
 * PUT do, on two real Loom products copied whole:
 *
 *   r1lt19L-v2   its machine is ref 1's own copy, with no configuration file
 *   r1lt19L-v3   Loom's own save: the product's machine, synced into ref 1's configuration
 *
 * A save writes what Loom's does (the product's machine, the ref's copy removed, the ref's
 * configuration synced), only on the canonical ref, only when valid and under the draft's
 * revision. A discard, or restoring a version, puts every file back byte for byte.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ActivityDetail, ActivityDraft, ActivityRecord } from "../src/activities/domain.js";
import type {
  StateMachineCheck,
  StateMachineDocument,
} from "../src/activities/state-machine-types.js";
import type { VersionSaveResult } from "../src/activities/version-types.js";
import { STATE_MACHINE_CONFIGURATION_KEY } from "../src/activities/state-machine-configuration.js";
import { scaffoldModule } from "../src/activities/waf-module.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "loom-state-machine",
);

type Machine = Record<string, unknown> & { states: Record<string, Record<string, unknown>> };
type Json = Record<string, Record<string, unknown>>;

const productMachine = (code: string) => `generated/${code}/spec/state-machine.json`;
const refCopy = (code: string) => `generated/${code}/refs/${code}-1/spec/state-machine.json`;
const configurationOf = (code: string) => `configurations/${code}-1.json`;

describe("state machine edits", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function open(code: "r1lt19L-v2" | "r1lt19L-v3") {
    const folder = `waf-module-${code}`;
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    const module = path.join(t.root, "waf-checkout", "modules", folder);
    await fs.cp(path.join(FIXTURES, folder), module, { recursive: true });
    const owner = await provisionUser(t.app, "machine");
    const api = apiClient(t.app, owner.cookie);
    const project = await api.post("/api/projects", { projectId: "machine-work" });
    expect(project.status, await project.clone().text()).toBe(201);
    const base = "/api/projects/machine-work/activities";
    const listed = (await (await api.get(base)).json()) as { activities: ActivityRecord[] };
    const id = listed.activities.find((activity) => activity.productCode === code)!.id;
    const file = (relative: string) => path.join(module, relative);
    /** Each file a save touches, as text; null when it is not there. */
    const files = async () => {
      const texts: Record<string, string | null> = {};
      for (const relative of [productMachine(code), refCopy(code), configurationOf(code)])
        texts[relative] = await fs.readFile(file(relative), "utf8").catch(() => null);
      return texts;
    };
    const original = await files();
    const detail = async (of = id) =>
      (await (await api.get(`${base}/${of}`)).json()) as ActivityDetail;
    const read = async (of = id) => {
      const response = await api.get(`${base}/${of}/state-machine`);
      expect(response.status, await response.clone().text()).toBe(200);
      return (await response.json()) as StateMachineDocument;
    };
    const put = (definition: unknown, expectedRevision: string, of = id) =>
      api.put(`${base}/${of}/state-machine`, { definition, expectedRevision });
    const discard = (expectedRevision: string) =>
      api.post(`${base}/${id}/state-machine/discard`, { expectedRevision });
    const machine = JSON.parse(
      (original[productMachine(code)] ?? original[refCopy(code)])!,
    ) as Machine;
    return { t, api, base, id, code, file, files, original, machine, detail, read, put, discard };
  }

  /** The machine with its first scene's description changed: a valid edit. */
  const describeIntro = (machine: unknown, text: string): Machine => {
    const edited = structuredClone(machine) as Machine;
    const first = Object.keys(edited.states).find((name) => name !== "activity")!;
    edited.states[first]!.description = text;
    return edited;
  };

  it("reads a ref's own Loom machine, with the problems it has", async () => {
    const { read, machine, code } = await open("r1lt19L-v2");
    const document = await read();
    expect(document).toMatchObject({
      productCode: code,
      refNum: 1,
      source: "ref",
      file: refCopy(code),
      edited: false,
      stale: false,
      editable: true,
      locked: null,
      canonicalRefNum: 1,
    });
    expect(document.definition).toEqual(machine);
    // Loom wrote it before Loom required `activity` to start at `complete`.
    expect(document.validation).toEqual({
      valid: false,
      issues: [expect.objectContaining({ code: "activity.initial" })],
    });
  });

  it("saves as Loom does, to the product's machine, and discards every file back exactly", async () => {
    const { read, put, discard, detail, files, original, machine, code } = await open("r1lt19L-v2");
    const before = (await detail()).draft;
    const edit = describeIntro(machine, "Scene 1, edited in WAF Harness.");

    const saved = await put(edit, before.contentRevision);
    expect(saved.status, await saved.clone().text()).toBe(200);
    const draft = (await saved.json()) as ActivityDraft;
    // A new revision, so what was built from the old one reads as out of date.
    expect(draft.contentRevision).not.toBe(before.contentRevision);
    expect(draft.moduleDocuments?.stateMachine?.value).toEqual(edit);
    // The product's machine holds the edit, the ref's copy is gone, and the ref's
    // configuration carries the machine and its scene catalog.
    const after = await files();
    expect(JSON.parse(after[productMachine(code)]!)).toEqual(edit);
    expect(after[refCopy(code)]).toBeNull();
    const configuration = JSON.parse(after[configurationOf(code)]!) as Json;
    expect(configuration[code]![STATE_MACHINE_CONFIGURATION_KEY]).toEqual(edit);
    expect(configuration[code]!.activityScenes).toHaveLength(12);
    expect(await read()).toMatchObject({
      source: "draft",
      file: productMachine(code),
      edited: true,
      stale: false,
      definition: edit,
    });

    // Saving again keeps what the files held before the first edit, for the discard.
    const again = await put(describeIntro(edit, "Twice."), draft.contentRevision);
    expect(again.status, await again.clone().text()).toBe(200);
    const twice = (await again.json()) as ActivityDraft;

    const discarded = await discard(twice.contentRevision);
    expect(discarded.status, await discarded.clone().text()).toBe(200);
    expect(((await discarded.json()) as ActivityDraft).contentRevision).toBe(
      before.contentRevision,
    );
    expect(await files()).toEqual(original);
    expect(await read()).toMatchObject({ source: "ref", edited: false });
  });

  it("syncs a Loom product's own machine into the configuration, and discards both exactly", async () => {
    const { read, put, discard, detail, files, original, machine, code } = await open("r1lt19L-v3");
    expect(await read()).toMatchObject({ source: "product", file: productMachine(code) });
    const before = (await detail()).draft;
    const edit = describeIntro(machine, "Edited.");
    const saved = (await (await put(edit, before.contentRevision)).json()) as ActivityDraft;
    const after = await files();
    expect(JSON.parse(after[productMachine(code)]!)).toEqual(edit);
    const configuration = JSON.parse(after[configurationOf(code)]!) as Json;
    const loom = JSON.parse(original[configurationOf(code)]!) as Json;
    // Only the machine changed: the media groups Loom wrote are as they were.
    expect(configuration[code]![STATE_MACHINE_CONFIGURATION_KEY]).toEqual(edit);
    expect(configuration[code]!["en-US"]).toEqual(loom[code]!["en-US"]);
    expect((await discard(saved.contentRevision)).status).toBe(200);
    expect(await files()).toEqual(original);
  });

  it("keeps the files in step when a version is restored", async () => {
    const { api, base, id, put, detail, files, original, machine, code } = await open("r1lt19L-v3");
    const keep = async (label: string) => {
      const response = await api.post(`${base}/${id}/versions`, { label });
      expect(response.status, await response.clone().text()).toBe(201);
      return ((await response.json()) as VersionSaveResult).version.versionId;
    };
    const restore = async (versionId: string) => {
      const response = await api.post(`${base}/${id}/versions/${versionId}/restore`, {
        expectedRevision: (await detail()).draft.contentRevision,
      });
      expect(response.status, await response.clone().text()).toBe(200);
    };
    const unedited = await keep("before");
    const first = describeIntro(machine, "First.");
    expect((await put(first, (await detail()).draft.contentRevision)).status).toBe(200);
    const edited = await keep("first");
    const second = describeIntro(machine, "Second.");
    expect((await put(second, (await detail()).draft.contentRevision)).status).toBe(200);

    await restore(edited);
    const restored = await files();
    expect(JSON.parse(restored[productMachine(code)]!)).toEqual(first);
    expect(
      (JSON.parse(restored[configurationOf(code)]!) as Json)[code]![
        STATE_MACHINE_CONFIGURATION_KEY
      ],
    ).toEqual(first);

    // The version from before any edit has none: the files are the module's own again.
    await restore(unedited);
    expect(await files()).toEqual(original);
  });

  it("refuses an invalid machine with a 400 naming its problems, and changes nothing", async () => {
    const { put, detail, files, original, machine } = await open("r1lt19L-v2");
    const before = (await detail()).draft;
    const broken = describeIntro(machine, "Broken.");
    broken.states["scene-1"]!.initial = "nowhere";
    broken.states["scene-13"] = {};

    const refused = await put(broken, before.contentRevision);
    expect(refused.status).toBe(400);
    const body = (await refused.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("state_machine_invalid");
    expect(body.error.message).toContain('State "scene-1" has unknown initial child "nowhere".');
    expect(body.error.message).toContain('unknown scene state "scene-13"');
    // The problem the machine already had is not the author's to fix first.
    expect(body.error.message).not.toContain('"complete" as its initial child');
    expect((await detail()).draft.contentRevision).toBe(before.contentRevision);
    expect(await files()).toEqual(original);

    const notObject = await put([], before.contentRevision);
    expect(notObject.status).toBe(400);
    expect(await notObject.json()).toMatchObject({ error: { code: "bad_request" } });
  });

  it("checks an unsaved machine, marking what the saved one already had", async () => {
    const { api, base, id, machine } = await open("r1lt19L-v2");
    const edited = describeIntro(machine, "Checked.");
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
    const { put, detail, machine } = await open("r1lt19L-v2");
    const before = (await detail()).draft;
    const first = await put(describeIntro(machine, "First."), before.contentRevision);
    expect(first.status).toBe(200);
    const late = await put(describeIntro(machine, "Late."), before.contentRevision);
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ error: { code: "draft_conflict" } });
  });

  it("shares the product's machine with every ref, edited on the canonical one", async () => {
    const { api, base, put, read, detail, machine, code } = await open("r1lt19L-v3");
    const created = await api.post(base, { productCode: code, refNum: 2, title: "Ref 2" });
    expect(created.status, await created.clone().text()).toBe(201);
    const two = (await created.json()) as ActivityDetail;
    expect(await read(two.id)).toMatchObject({
      source: "product",
      definition: machine,
      editable: false,
      locked: "shared",
      canonicalRefNum: 1,
    });
    const refused = await put(
      describeIntro(machine, "From ref 2."),
      two.draft.contentRevision,
      two.id,
    );
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "not_canonical" } });
    // Ref 1's edit is the one ref 2 reads.
    const edit = describeIntro(machine, "From ref 1.");
    expect((await put(edit, (await detail()).draft.contentRevision)).status).toBe(200);
    expect(await read(two.id)).toMatchObject({
      source: "draft",
      definition: edit,
      editable: false,
    });
  });

  it("reports the edit stale when the specification's scenes change, not their words", async () => {
    const { api, base, id, put, read, detail, machine } = await open("r1lt19L-v2");
    const before = (await detail()).draft;
    expect((await put(describeIntro(machine, "Edited."), before.contentRevision)).status).toBe(200);
    const respec = async (change: (scenes: Record<string, unknown>[]) => void) => {
      const current = (await detail()).draft;
      const spec = structuredClone(current.spec) as { scenes: Record<string, unknown>[] };
      change(spec.scenes);
      const response = await api.post(`${base}/${id}/apply-generated-spec`, {
        spec,
        expectedRevision: current.contentRevision,
      });
      expect(response.status, await response.clone().text()).toBe(200);
    };
    await respec((scenes) => (scenes[0]!.description = "A new first scene."));
    expect(await read()).toMatchObject({ edited: true, stale: false });
    await respec((scenes) => scenes.pop());
    expect(await read()).toMatchObject({ edited: true, stale: true });
  });

  it("assembles the edited machine as the product's, synced into the configuration", async () => {
    const { put, detail, machine, code } = await open("r1lt19L-v2");
    const edit = describeIntro(machine, "Assembled.");
    expect((await put(edit, (await detail()).draft.contentRevision)).status).toBe(200);
    const files = scaffoldModule(await detail());
    expect(JSON.parse(files[productMachine(code)]!)).toEqual(edit);
    expect(files[refCopy(code)]).toBeUndefined();
    const configuration = JSON.parse(files[configurationOf(code)]!) as Json;
    expect(configuration[code]![STATE_MACHINE_CONFIGURATION_KEY]).toEqual(edit);
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
