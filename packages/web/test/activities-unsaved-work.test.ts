import { describe, expect, it } from "vitest";
import {
  UnsavedWork,
  discardWording,
  type HeldWork,
} from "../src/features/activities/unsaved-work";

const draft: HeldWork = { label: "draft" };
const document: HeldWork = { label: "module document", section: "configuration" };
const timeline: HeldWork = {
  label: "scene timeline",
  section: "scenes",
  asset: { key: "intro-video", language: "en-US" },
};

const labels = (works: readonly HeldWork[]) => works.map((work) => work.label);

/** A guard with the three kinds of holder, each holding work. */
function holding() {
  const work = new UnsavedWork();
  const ids = { draft: work.holder(), document: work.holder(), timeline: work.holder() };
  work.set(ids.draft, draft);
  work.set(ids.document, document);
  work.set(ids.timeline, timeline);
  return { work, ids };
}

describe("the unsaved-work guard", () => {
  it("counts work while its holder holds it, and not after", () => {
    const work = new UnsavedWork();
    const id = work.holder();
    expect(work.held()).toEqual([]);
    work.set(id, timeline);
    expect(labels(work.held())).toEqual(["scene timeline"]);
    work.set(id, null);
    expect(work.held()).toEqual([]);
  });

  it("asks before leaving the activity for everything held", () => {
    const { work } = holding();
    expect(labels(work.lost({ kind: "activity" }))).toEqual([
      "draft",
      "module document",
      "scene timeline",
    ]);
  });

  it("asks before a section switch only for the closing section's own editor", () => {
    const { work } = holding();
    expect(labels(work.lost({ kind: "section", from: "scenes", to: "description" }))).toEqual([
      "scene timeline",
    ]);
    expect(labels(work.lost({ kind: "section", from: "configuration", to: "module" }))).toEqual([
      "module document",
    ]);
    // The draft's texts are the page's and survive any switch; choosing the open section
    // again keeps its editor.
    expect(work.lost({ kind: "section", from: "description", to: "scenes" })).toEqual([]);
    expect(work.lost({ kind: "section", from: "scenes", to: "scenes" })).toEqual([]);
  });

  it("asks before replacing the draft's texts only for the draft", () => {
    const { work } = holding();
    expect(labels(work.lost({ kind: "draftText" }))).toEqual(["draft"]);
  });

  it("keeps a section open while its own editor holds work", () => {
    const { work, ids } = holding();
    expect(work.holds("scenes")).toBe(true);
    expect(work.holds("description")).toBe(false);
    work.set(ids.timeline, null);
    expect(work.holds("scenes")).toBe(false);
  });

  it("drops discarded work until its holder says again that it holds it", () => {
    const { work, ids } = holding();
    work.discard(work.lost({ kind: "section", from: "scenes", to: "description" }));
    expect(labels(work.held())).toEqual(["draft", "module document"]);
    work.set(ids.timeline, { ...timeline });
    expect(labels(work.held())).toEqual(["draft", "module document", "scene timeline"]);
    work.discard(work.lost({ kind: "activity" }));
    expect(work.held()).toEqual([]);
  });

  it("announces a change only when what is held changes", () => {
    const work = new UnsavedWork();
    const id = work.holder();
    let heard = 0;
    work.subscribe(() => heard++);
    const version = work.getVersion();
    work.set(id, draft);
    work.set(id, { ...draft });
    work.set(id, null);
    work.set(id, null);
    expect(heard).toBe(2);
    expect(work.getVersion()).toBe(version + 2);
  });

  it("asks before the asset editor shows another asset only for that asset's work", () => {
    const work = new UnsavedWork();
    const card: HeldWork = {
      label: "unsaved file",
      section: "scenes",
      asset: { key: "intro-video" },
    };
    const beside: HeldWork = { label: "unsaved file", section: "scenes", asset: "editor" };
    for (const held of [draft, timeline, card, beside]) work.set(work.holder(), held);
    const leaving = (to: { key: string; language?: string } | null) =>
      labels(work.lost({ kind: "asset", to }));
    // Another asset: its timeline and its card go; a file held beside whichever asset is
    // shown stays, and so does the draft.
    expect(leaving({ key: "sky", language: "en-US" })).toEqual(["scene timeline", "unsaved file"]);
    // The same asset in another language: only the timeline, which is that language's.
    expect(leaving({ key: "intro-video", language: "es-MX" })).toEqual(["scene timeline"]);
    expect(leaving({ key: "intro-video", language: "en-US" })).toEqual([]);
    // The storyboard closes the editor: everything it holds goes.
    expect(leaving(null)).toEqual(["scene timeline", "unsaved file", "unsaved file"]);
  });

  it("asks in the words of the work at stake", () => {
    const file: HeldWork = { label: "unsaved file", section: "scenes", asset: "editor" };
    const section = { kind: "section", from: "scenes", to: "description" } as const;
    expect(discardWording(section, [document])).toBe("document");
    expect(discardWording(section, [file, timeline])).toBe("timeline");
    expect(discardWording({ kind: "asset", to: null }, [file])).toBe("file");
    // Leaving the activity, or the draft's texts, keeps the words it always had.
    expect(discardWording({ kind: "activity" }, [timeline])).toBe("draft");
    expect(discardWording({ kind: "draftText" }, [draft])).toBe("draft");
  });

  it("asks before an editor starts over only for that editor's work", () => {
    const work = new UnsavedWork();
    const plan: HeldWork = { label: "new ref plan", section: "newRef" };
    for (const held of [draft, plan]) work.set(work.holder(), held);
    const restart = { kind: "restart", label: "new ref plan" } as const;
    expect(labels(work.lost(restart))).toEqual(["new ref plan"]);
    expect(discardWording(restart, [plan])).toBe("refPlan");
    // Leaving the page for another section loses the plan too, in the same words.
    const section = { kind: "section", from: "newRef", to: "scenes" } as const;
    expect(labels(work.lost(section))).toEqual(["new ref plan"]);
    expect(discardWording(section, [plan])).toBe("refPlan");
  });
});
