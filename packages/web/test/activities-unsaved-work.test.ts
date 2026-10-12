import { describe, expect, it } from "vitest";
import { UnsavedWork, type HeldWork } from "../src/features/activities/unsaved-work";

const draft: HeldWork = { label: "draft" };
const document: HeldWork = { label: "module document", section: "configuration" };
const timeline: HeldWork = { label: "scene timeline", section: "scenes" };

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
});
