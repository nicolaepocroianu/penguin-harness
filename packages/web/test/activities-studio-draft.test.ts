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
import { S } from "../src/lib/strings";

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

interface Call {
  path: string;
  method: string;
  body: Record<string, unknown> | undefined;
  answer: (value: unknown) => void;
  refuse: (error: unknown) => void;
}

/** A draft over a server whose every answer the test gives by hand. */
function studio(context: DraftContext = open) {
  const calls: Call[] = [];
  const toasts: string[] = [];
  const saved = vi.fn(async () => {});
  const draft = new StudioDraft(
    {
      request: <T>(path: string, method: string, body?: unknown) =>
        new Promise<T>((resolve, reject) =>
          calls.push({
            path,
            method,
            body: body as Record<string, unknown> | undefined,
            answer: (value) => resolve(value as T),
            refuse: reject,
          }),
        ),
      saved,
      toast: (text) => toasts.push(text),
    },
    context,
  );
  draft.attach();
  draft.replace(detailAt("r1"));
  return { draft, calls, toasts, saved };
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

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
});

describe("drafts from the server", () => {
  it("never puts the poll's draft over unsaved text, and says the draft moved", () => {
    const { draft } = studio();
    draft.edit("description", "Mine");
    draft.receive(detailAt("r2", { description: "Theirs" }), "r1");
    expect(draft.state).toMatchObject({ description: "Mine", changed: true });
    expect(draft.revision).toBe("r1");

    // Without unsaved text the poll's draft is taken, and the notice goes.
    draft.edit("description", "Saved script");
    draft.receive(detailAt("r2", { description: "Theirs" }), "r1");
    expect(draft.state).toMatchObject({ description: "Theirs", changed: false });
    // A poll that started before the draft moved is old news.
    draft.receive(detailAt("r0", { description: "Older" }), "r1");
    expect(draft.state.description).toBe("Theirs");
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
