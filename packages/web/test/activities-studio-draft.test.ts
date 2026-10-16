import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityDetail, ActivityDraft, AssetManifest } from "@prismshadow/penguin-server/api";
import {
  MEDIA_AUTOSAVE_MS,
  SCRIPT_AUTOSAVE_MS,
  StudioDraft,
  blockedBy,
  readManifest,
  type DraftAction,
  type DraftBlock,
  type DraftContext,
  type DraftFacts,
} from "../src/features/activities/studio-draft";
import { ApiError } from "../src/api/client";
import { S } from "../src/lib/strings";
import { memoryActivity, settle } from "./activity-memory-api";

const manifest = {
  assets: {
    "en-US": [{ key: "hello", type: "audio", description: "Hi", usages: [{ sceneId: "intro" }] }],
  },
} as unknown as AssetManifest;

const draftAt = (revision: string, extra: Partial<ActivityDraft> = {}) =>
  ({
    draftId: "d",
    description: "Saved script",
    spec: { title: "From the spec" },
    status: "valid",
    contentRevision: revision,
    mediaPlan: { manifest },
    ...extra,
  }) as unknown as ActivityDraft;

const detailAt = (revision: string, extra: Partial<ActivityDraft> = {}) =>
  ({
    id: "a1",
    title: "Saved title",
    productCode: "P",
    refNum: 1,
    draft: draftAt(revision, extra),
  }) as unknown as ActivityDetail;

const open: DraftContext = {
  editable: true,
  available: true,
  running: false,
  stages: false,
  hasAgent: true,
};

/** A draft over the in-memory activity client, whose every answer the test gives by hand. */
function studio(context: DraftContext = open) {
  const { api, calls } = memoryActivity();
  const toasts: string[] = [];
  const saved = vi.fn(async () => {});
  const draft = new StudioDraft({ api, saved, toast: (text) => toasts.push(text) }, context);
  draft.attach();
  draft.replace(detailAt("r1"));
  return { draft, calls, toasts, saved };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the studio draft's autosaves", () => {
  it("saves the script after a pause in typing, and each edit restarts the wait", async () => {
    const { draft, calls, toasts } = studio();
    draft.edit("description", "New");
    vi.advanceTimersByTime(SCRIPT_AUTOSAVE_MS - 1);
    draft.edit("description", "Newer");
    vi.advanceTimersByTime(SCRIPT_AUTOSAVE_MS - 1);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(calls).toMatchObject([
      {
        path: "description",
        method: "PATCH",
        body: { expectedRevision: "r1", description: "Newer" },
      },
    ]);
    expect(draft.state.scriptSave).toBe("saving");
    // Typed while it saves: stays, and is still unsaved once the save lands.
    draft.edit("description", "Newest");
    calls[0]!.answer(draftAt("r2", { description: "Newer" }));
    await settle();
    expect(draft.state).toMatchObject({ scriptSave: "saved", description: "Newest", dirty: true });
    expect(draft.revision).toBe("r2");
    // An autosave is quiet.
    expect(toasts).toEqual([]);
  });

  it("holds the script's autosave while a run or the stages are under way", () => {
    const { draft, calls } = studio({ ...open, running: true });
    draft.edit("description", "New");
    vi.advanceTimersByTime(SCRIPT_AUTOSAVE_MS * 3);
    draft.setContext({ ...open, stages: true });
    vi.advanceTimersByTime(SCRIPT_AUTOSAVE_MS * 3);
    expect(calls).toEqual([]);
    draft.setContext(open);
    vi.advanceTimersByTime(SCRIPT_AUTOSAVE_MS);
    expect(calls.map((call) => call.path)).toEqual(["description"]);
  });

  it("saves the asset editor's edits a moment after the last, but never typed manifest JSON", async () => {
    const { draft, calls } = studio();
    const changed = structuredClone(manifest);
    changed.assets["en-US"]![0]!.description = "Hello";
    draft.edit("media", JSON.stringify(changed));
    vi.advanceTimersByTime(MEDIA_AUTOSAVE_MS * 10);
    expect(calls).toEqual([]);
    expect(draft.state.mediaSave).toBeNull();

    draft.editManifest(changed);
    expect(draft.state.mediaSave).toBe("pending");
    vi.advanceTimersByTime(MEDIA_AUTOSAVE_MS);
    expect(calls).toMatchObject([
      { path: "media", method: "PUT", body: { expectedRevision: "r1", manifest: changed } },
    ]);
    calls[0]!.answer(draftAt("r2", { mediaPlan: { manifest: changed } as never }));
    await settle();
    expect(draft.state).toMatchObject({ mediaSave: "saved", dirty: false });
  });

  it("reads saved again when the asset editor's edits end back on the saved manifest", () => {
    const { draft, calls } = studio();
    const changed = structuredClone(manifest);
    changed.assets["en-US"]![0]!.description = "Hello";
    draft.editManifest(changed);
    expect(draft.state.mediaSave).toBe("pending");
    vi.advanceTimersByTime(MEDIA_AUTOSAVE_MS - 1);
    draft.editManifest(manifest);
    vi.advanceTimersByTime(MEDIA_AUTOSAVE_MS * 3);
    expect(calls).toEqual([]);
    expect(draft.state).toMatchObject({ mediaSave: "saved", dirty: false });
  });
});

describe("drafts from the server", () => {
  it("merges the poll's draft field by field, and takes it whole over nothing unsaved", () => {
    const { draft } = studio();
    draft.edit("description", "Mine");
    // Another field changed: taken, under the edit, which now sits on the newer draft.
    draft.receive(detailAt("r2", { spec: { title: "Theirs" } }), "r1");
    expect(draft.state).toMatchObject({ description: "Mine", changed: false });
    expect(draft.state.spec).toBe(JSON.stringify({ title: "Theirs" }, null, 2));
    expect(draft.revision).toBe("r2");

    // Without unsaved text the poll's draft is taken whole.
    draft.edit("description", "Saved script");
    draft.receive(detailAt("r3", { description: "Theirs" }), "r2");
    expect(draft.state).toMatchObject({ description: "Theirs", changed: false });
    // A poll that started before the draft moved is old news.
    draft.receive(detailAt("r0", { description: "Older" }), "r2");
    expect(draft.state.description).toBe("Theirs");
  });

  it("takes nothing from a poll that read what it holds, and tells no one", () => {
    const { draft } = studio();
    const held = draft.state;
    const told = vi.fn();
    draft.subscribe(told);
    // Each poll's answer is a new object, read from JSON.
    draft.receive(structuredClone(detailAt("r1")), "r1");
    expect(told).not.toHaveBeenCalled();
    expect(draft.state).toBe(held);
  });

  it("takes a poll's detail when only the record or the draft's bookkeeping moved", () => {
    const { draft } = studio();
    const told = vi.fn();
    draft.subscribe(told);
    // A product's tags change on the product, and the ref's own row keeps its updatedAt.
    draft.receive({ ...detailAt("r1"), tags: ["phonics"] }, "r1");
    expect(draft.state.detail?.tags).toEqual(["phonics"]);
    // A pin leaves the revision as it was.
    draft.receive({ ...detailAt("r1", { pinnedModuleRunId: "run_1" }), tags: ["phonics"] }, "r1");
    expect(draft.state.detail?.draft.pinnedModuleRunId).toBe("run_1");
    expect(told).toHaveBeenCalledTimes(2);
  });

  it("applies a draft keeping the author's unsaved text, or replacing it, as asked", () => {
    const { draft } = studio();
    draft.edit("description", "Mine");
    draft.edit("spec", '{"title":"Typed"}');
    draft.applyDraft(draftAt("r2", { spec: { title: "New title" } }), "unsaved");
    expect(draft.state).toMatchObject({ description: "Mine", spec: '{"title":"Typed"}' });
    expect(draft.state.detail).toMatchObject({ title: "New title" });
    expect(draft.state.edited).toEqual({ description: true, spec: true, media: false });

    draft.applyDraft(draftAt("r3", { status: "invalid", description: "Theirs" }), "none");
    expect(draft.state).toMatchObject({ description: "Theirs", dirty: false });
    // An invalid specification leaves the title as it was.
    expect(draft.state.detail?.title).toBe("New title");
  });

  it("names the draft's revision on every change, and takes one change at a time", async () => {
    const { draft, calls, toasts } = studio();
    const first = draft.acceptRun("run 1", "accept-audio");
    expect(await draft.acceptRun("run_2", "accept-image")).toBe(false);
    expect(calls).toMatchObject([
      { path: "runs/run%201/accept-audio", method: "POST", body: { expectedRevision: "r1" } },
    ]);
    calls[0]!.answer(draftAt("r2"));
    expect(await first).toBe(true);
    expect(toasts).toEqual([S.activities.saved]);
    expect(draft.revision).toBe("r2");
  });

  it("refuses an agent's change over unsaved text without sending it", async () => {
    const { draft, calls } = studio();
    draft.edit("spec", "{}");
    expect(await draft.act(() => draft.land({ target: "description", text: "x" }))).toBe(false);
    expect(calls).toEqual([]);
    expect(draft.state.error).not.toBe("");
  });

  it("follows a ref's new number, keeping the unsaved script", () => {
    const { draft } = studio();
    const renumbered = detailAt("r2");
    draft.renumbered(renumbered, 1);
    expect(draft.state.media).toBe(JSON.stringify(manifest, null, 2));
    draft.edit("description", "Mine");
    draft.renumbered({ ...renumbered, refNum: 2 }, 1);
    expect(draft.state).toMatchObject({ description: "Mine" });
  });
});

describe("what the draft lets an author press", () => {
  const clear: DraftFacts = {
    ...open,
    busy: false,
    dirty: false,
    valid: true,
    hasSpec: true,
  };
  /** Every fact that blocks something, as the reason it is reported by. */
  const failing: Record<DraftBlock, Partial<DraftFacts>> = {
    readonly: { editable: false },
    unavailable: { available: false },
    busy: { busy: true },
    running: { running: true },
    stages: { stages: true },
    unsaved: { dirty: true },
    invalid: { valid: false },
    noSpec: { hasSpec: false },
    agent: { hasAgent: false },
  };
  /** The reasons `action` reports, removing each in turn from a page where everything fails. */
  const reasons = (action: DraftAction) => {
    let facts: DraftFacts = Object.assign({ ...clear }, ...Object.values(failing));
    const found: DraftBlock[] = [];
    for (let reason = blockedBy(action, facts); reason; reason = blockedBy(action, facts)) {
      found.push(reason);
      facts = {
        ...facts,
        ...Object.fromEntries(
          Object.keys(failing[reason]).map((key) => [key, clear[key as keyof DraftFacts]]),
        ),
      };
    }
    return found;
  };

  it("reports each action's reasons in its order", () => {
    expect(reasons("agentRun")).toEqual([
      "readonly",
      "unavailable",
      "invalid",
      "busy",
      "running",
      "unsaved",
      "agent",
    ]);
    expect(reasons("mediaRun")).toEqual([
      "readonly",
      "unavailable",
      "invalid",
      "busy",
      "running",
      "unsaved",
    ]);
    expect(reasons("draftChange")).toEqual([
      "readonly",
      "unavailable",
      "busy",
      "running",
      "unsaved",
    ]);
    expect(reasons("preview")).toEqual(["readonly", "unavailable", "busy", "unsaved"]);
    expect(reasons("edit")).toEqual(["unavailable", "busy"]);
    expect(reasons("planMedia")).toEqual(["busy", "running", "unsaved", "invalid", "noSpec"]);
    // Running the stages says "save first" before "another run", and never waits on a change.
    expect(reasons("stages")).toEqual([
      "readonly",
      "unavailable",
      "unsaved",
      "running",
      "stages",
      "agent",
    ]);
    expect(reasons("recordWords")).toEqual([
      "readonly",
      "unavailable",
      "busy",
      "unsaved",
      "running",
      "stages",
      "agent",
    ]);
    expect(reasons("wordsRun")).toEqual([
      "readonly",
      "unavailable",
      "busy",
      "running",
      "unsaved",
      "agent",
    ]);
    expect(reasons("assessment")).toEqual(["running", "stages", "agent"]);
    expect(reasons("tests")).toEqual(["readonly", "running", "unsaved", "agent"]);
    expect(reasons("quality")).toEqual(["readonly", "running"]);
  });

  it("reads what is unsaved, in flight and valid from the draft itself", async () => {
    const { draft, calls } = studio();
    expect(draft.can("agentRun")).toBeNull();
    draft.edit("description", "Mine");
    expect(draft.can("agentRun")).toBe("unsaved");
    draft.edit("description", "Saved script");
    void draft.save("spec");
    expect(draft.can("agentRun")).toBe("busy");
    calls[0]!.answer(draftAt("r2", { status: "invalid" }));
    await settle();
    expect(draft.can("agentRun")).toBe("invalid");
    draft.observe({ ...open, hasAgent: false });
    expect(draft.can("assessment")).toBe("agent");
  });
});

describe("the manifest the structured editors read", () => {
  it("takes only the saved shape", () => {
    const text = JSON.stringify(manifest);
    expect(readManifest(text)).toEqual(manifest);
    expect(readManifest("{")).toBeNull();
    expect(readManifest(JSON.stringify({ assets: { "en-US": [{ key: "x" }] } }))).toBeNull();
    const bound = structuredClone(manifest) as unknown as { assets: Record<string, object[]> };
    bound.assets["en-US"]![0] = {
      ...bound.assets["en-US"]![0],
      generatedImage: { runId: "r" },
    };
    // A generated image names its file's hash too.
    expect(readManifest(JSON.stringify(bound))).toBeNull();
  });
});

describe("the field-level merge", () => {
  const video = {
    key: "intro-video",
    type: "video",
    description: "The sky",
    usages: [{ sceneId: "intro" }],
  };
  const withVideo = (extra: Record<string, unknown> = {}, hello: Record<string, unknown> = {}) =>
    ({
      assets: {
        "en-US": [
          { ...manifest.assets["en-US"]![0], ...hello },
          { ...video, ...extra },
        ],
      },
    }) as unknown as AssetManifest;
  const cut = (outMs: number) =>
    ({
      version: 1,
      width: 640,
      height: 480,
      fps: 30,
      cuts: [{ id: "c1", source: { runId: "v1" }, inMs: 0, outMs }],
      narration: [],
      music: null,
      effects: [],
      captions: { enabled: true, maxWords: 8, maxChars: 42 },
    }) as never;
  const planAt = (revision: string, extra: Record<string, unknown>, hello = {}) =>
    detailAt(revision, { mediaPlan: { manifest: withVideo(extra, hello) } as never });
  /** A studio whose draft has a video, and a timeline being edited on it. */
  function editing() {
    const setup = studio();
    setup.draft.replace(planAt("r1", {}));
    setup.draft.editTimeline("en-US", "intro-video", cut(4000));
    return setup;
  }

  it("keeps a timeline's edit when another asset changes, and moves the revision", () => {
    const { draft } = editing();
    draft.receive(planAt("r2", {}, { path: "media/hello.mp3" }), "r1");
    expect(draft.timeline("en-US", "intro-video")).toEqual(cut(4000));
    expect(draft.revision).toBe("r2");
    expect(draft.state.changed).toBe(false);
  });

  it("lets the author's own timeline save land, and the edit goes", async () => {
    const { draft, calls, toasts } = editing();
    const saving = draft.saveTimeline("en-US", "intro-video", cut(4000));
    expect(calls).toMatchObject([
      {
        path: "video-timeline",
        method: "PUT",
        body: { expectedRevision: "r1", assetKey: "intro-video", timeline: cut(4000) },
      },
    ]);
    // The server writes the timeline back in its own key order.
    const written = JSON.parse(JSON.stringify(cut(4000), Object.keys(cut(4000)).reverse()));
    calls[0]!.answer(planAt("r2", { timeline: written }).draft);
    expect(await saving).toBe(true);
    expect(draft.timeline("en-US", "intro-video")).toBeNull();
    expect(draft.state.changed).toBe(false);
    expect(toasts).toEqual([S.activities.saved]);
  });

  it("keeps a timeline's edit equal to the saved one through polls of the same draft, until it is saved or dropped", async () => {
    const { draft, calls } = studio();
    const saved = planAt("r1", { timeline: cut(4000) });
    draft.replace(saved);
    // Each poll's answer is a new object, read from JSON.
    const poll = () => draft.receive(structuredClone(saved), "r1");
    draft.editTimeline("en-US", "intro-video", cut(4000));
    poll();
    poll();
    expect(draft.timeline("en-US", "intro-video")).toEqual(cut(4000));
    draft.dropTimeline("en-US", "intro-video");
    expect(draft.timeline("en-US", "intro-video")).toBeNull();

    draft.editTimeline("en-US", "intro-video", cut(4000));
    poll();
    expect(draft.timeline("en-US", "intro-video")).toEqual(cut(4000));
    const saving = draft.saveTimeline("en-US", "intro-video", cut(4000));
    calls[0]!.answer(planAt("r2", { timeline: cut(4000) }).draft);
    expect(await saving).toBe(true);
    expect(draft.timeline("en-US", "intro-video")).toBeNull();

    // A draft that moved on the server is merged: the edit is what it holds, so it has landed.
    draft.editTimeline("en-US", "intro-video", cut(4000));
    draft.receive(planAt("r3", { timeline: cut(4000) }, { path: "media/hello.mp3" }), "r2");
    expect(draft.timeline("en-US", "intro-video")).toBeNull();
    expect(draft.state.changed).toBe(false);
  });

  it("keeps an edit to a field changed on both sides, and marks it in conflict", () => {
    const { draft } = editing();
    draft.edit("description", "Mine");
    const theirs = planAt("r2", { timeline: cut(9000) });
    theirs.draft.description = "Theirs";
    draft.receive(theirs, "r1");
    expect(draft.state.description).toBe("Mine");
    expect(draft.timeline("en-US", "intro-video")).toEqual(cut(4000));
    expect([...draft.state.conflicts].sort()).toEqual([
      "description",
      "timeline:en-US/intro-video",
    ]);
    expect(draft.state.changed).toBe(true);
    // The same value on both sides is no conflict: the edit has landed.
    const same = planAt("r3", { timeline: cut(9000) });
    same.draft.description = "Mine";
    draft.receive(same, "r2");
    expect(draft.state.conflicts.has("description")).toBe(false);
    expect(draft.state.dirty).toBe(false);
  });

  it("reads the draft again when a save is refused, and sends once more over another asset's change", async () => {
    const { draft, calls } = editing();
    const saving = draft.saveTimeline("en-US", "intro-video", cut(4000));
    calls[0]!.refuse(new ApiError(409, "draft_conflict", "Draft changed."));
    await settle();
    expect(calls[1]).toMatchObject({ path: "", method: "GET" });
    calls[1]!.answer(planAt("r2", {}, { path: "media/hello.mp3" }));
    await settle();
    expect(calls[2]).toMatchObject({ path: "video-timeline", body: { expectedRevision: "r2" } });
    calls[2]!.answer(planAt("r3", { timeline: cut(4000) }, { path: "media/hello.mp3" }).draft);
    expect(await saving).toBe(true);
    expect(draft.timeline("en-US", "intro-video")).toBeNull();
  });

  it("says so when a refused save's field changed on the server too, and keeps the edit", async () => {
    const { draft, calls } = editing();
    const saving = draft.saveTimeline("en-US", "intro-video", cut(4000));
    calls[0]!.refuse(new ApiError(409, "draft_conflict", "Draft changed."));
    await settle();
    calls[1]!.answer(planAt("r2", { timeline: cut(9000) }));
    expect(await saving).toBe(false);
    expect(calls).toHaveLength(2);
    expect(draft.state.error).toBe(S.errors.byCode.draft_conflict);
    expect(draft.timeline("en-US", "intro-video")).toEqual(cut(4000));
    // Saving it again is refused at once: the author reloads first.
    expect(await draft.saveTimeline("en-US", "intro-video", cut(4000))).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it("autosaves the plan merged with the newer draft, never over a newer field", () => {
    const { draft, calls } = studio();
    draft.replace(planAt("r1", {}));
    draft.editManifest(withVideo({ description: "A brighter sky" }));
    // Meanwhile a run bound the narration's file.
    draft.receive(planAt("r2", {}, { path: "media/hello.mp3" }), "r1");
    vi.advanceTimersByTime(MEDIA_AUTOSAVE_MS);
    expect(calls[0]).toMatchObject({ path: "media", body: { expectedRevision: "r2" } });
    const sent = (calls[0]!.body as { manifest: AssetManifest }).manifest.assets["en-US"]!;
    expect(sent.find((asset) => asset.key === "hello")!.path).toBe("media/hello.mp3");
    expect(sent.find((asset) => asset.key === "intro-video")!.description).toBe("A brighter sky");
  });

  it("merges the specification whole, by its value", () => {
    const { draft } = studio();
    draft.edit("spec", '{"title":"Typed"}');
    draft.receive(detailAt("r2", { description: "Theirs" }), "r1");
    expect(draft.state).toMatchObject({ spec: '{"title":"Typed"}', description: "Theirs" });
    expect(draft.state.changed).toBe(false);
    draft.receive(detailAt("r3", { description: "Theirs", spec: { title: "Other" } }), "r2");
    expect(draft.state.spec).toBe('{"title":"Typed"}');
    expect([...draft.state.conflicts]).toEqual(["spec"]);
  });

  it("keeps the author's version of a conflict when they choose it, and saves it at once", async () => {
    const { draft, calls } = editing();
    draft.receive(planAt("r2", { timeline: cut(9000) }), "r1");
    expect(draft.state.changed).toBe(true);
    draft.resolve(["timeline:en-US/intro-video"], "mine");
    expect(draft.state.changed).toBe(false);
    expect(draft.timeline("en-US", "intro-video")).toEqual(cut(4000));
    // The edit now sits on the newer draft: a later poll of it raises nothing.
    draft.receive(planAt("r2", { timeline: cut(9000) }), "r2");
    expect(draft.state.changed).toBe(false);
    // The save names the newer revision, so it is not refused, and it lands.
    const saving = draft.saveTimeline("en-US", "intro-video", cut(4000));
    expect(calls).toMatchObject([{ path: "video-timeline", body: { expectedRevision: "r2" } }]);
    calls[0]!.answer(planAt("r3", { timeline: cut(4000) }).draft);
    expect(await saving).toBe(true);
    expect(calls).toHaveLength(1);
    expect(draft.timeline("en-US", "intro-video")).toBeNull();
  });

  it("drops the author's version of a conflict when they take the saved one", () => {
    const { draft } = editing();
    draft.edit("description", "Mine");
    const theirs = planAt("r2", { timeline: cut(9000) });
    theirs.draft.description = "Theirs";
    draft.receive(theirs, "r1");
    draft.resolve(["description"], "theirs");
    expect(draft.state).toMatchObject({ description: "Theirs", dirty: false });
    expect([...draft.state.conflicts]).toEqual(["timeline:en-US/intro-video"]);
    draft.resolve(["timeline:en-US/intro-video"], "theirs");
    expect(draft.timeline("en-US", "intro-video")).toBeNull();
    expect(draft.state.changed).toBe(false);
  });

  it("takes the saved value of one asset's property and keeps the author's others", () => {
    const { draft } = studio();
    draft.replace(planAt("r1", {}));
    draft.edit(
      "media",
      JSON.stringify(withVideo({ description: "Mine" }, { description: "Hello there" }), null, 2),
    );
    draft.receive(planAt("r2", { description: "Theirs" }), "r1");
    expect([...draft.state.conflicts]).toEqual(["asset:en-US/intro-video#description"]);
    draft.resolve(["asset:en-US/intro-video#description"], "theirs");
    const group = (JSON.parse(draft.state.media) as AssetManifest).assets["en-US"]!;
    expect(group.find((asset) => asset.key === "intro-video")!.description).toBe("Theirs");
    expect(group.find((asset) => asset.key === "hello")!.description).toBe("Hello there");
    expect(draft.state.changed).toBe(false);
  });
});
