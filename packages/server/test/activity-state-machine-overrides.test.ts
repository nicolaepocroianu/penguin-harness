/**
 * What an assembly may do to an author's state machine edit, and when the edit is stale: it
 * may add to the machine, and drop a scene the specification no longer has, but not change
 * what the author wrote or put back what they removed; only a change to the scenes makes the
 * edit stale.
 */
import { describe, expect, it } from "vitest";
import type { ModuleDocumentOverride } from "../src/activities/domain.js";
import {
  documentBasis,
  isSharedDocument,
  keepsMachineEdit,
  removedKeys,
} from "../src/activities/module-overrides.js";

const spec = { scenes: [{ id: "intro", description: "Look" }, { id: "outro" }] };

function machine(): Record<string, unknown> {
  return {
    version: "1.1",
    id: "demo",
    initial: "intro",
    states: {
      intro: {
        entry: "present",
        on: { NEXT: "outro", HELP: { target: "outro", actions: "hint" } },
      },
      outro: { on: { NEXT: "#demo.activity.complete" } },
      activity: { initial: "complete", states: { complete: { type: "final" } } },
    },
  };
}

const override = (value: Record<string, unknown>, removed?: string[]): ModuleDocumentOverride => ({
  value,
  basis: null,
  editedAt: "2026-10-20T00:00:00.000Z",
  ...(removed ? { removed } : {}),
});

describe("a state machine edit", () => {
  it("records what the author removed, outermost key only, and forgets what they put back", () => {
    const edited = machine();
    const intro = (edited.states as Record<string, Record<string, unknown>>).intro!;
    delete (intro.on as Record<string, unknown>).HELP;
    delete intro.entry;
    const removed = removedKeys(machine(), edited);
    expect(removed).toEqual([
      JSON.stringify(["states", "intro", "entry"]),
      JSON.stringify(["states", "intro", "on", "HELP"]),
    ]);
    // A later save starts from the edit; the earlier removals stay until the key is back.
    const again = structuredClone(edited);
    (again.states as Record<string, Record<string, unknown>>).intro!.entry = "present";
    expect(removedKeys(edited, again, removed)).toEqual([
      JSON.stringify(["states", "intro", "on", "HELP"]),
    ]);
  });

  it("is kept by an assembly that adds to it", () => {
    const edit = machine();
    const assembled = structuredClone(edit);
    (assembled.states as Record<string, Record<string, unknown>>).intro!.exit = "cleanup";
    expect(keepsMachineEdit(assembled, override(edit), spec)).toBe(true);
  });

  it("is not kept by an assembly that changes it or puts back what the author removed", () => {
    const edit = machine();
    const changed = structuredClone(edit);
    (changed.states as Record<string, Record<string, unknown>>).intro!.entry = "other";
    expect(keepsMachineEdit(changed, override(edit), spec)).toBe(false);

    const removed = [JSON.stringify(["states", "intro", "on", "HELP"])];
    const without = structuredClone(edit);
    delete (
      (without.states as Record<string, Record<string, unknown>>).intro!.on as Record<
        string,
        unknown
      >
    ).HELP;
    expect(keepsMachineEdit(without, override(without, removed), spec)).toBe(true);
    // The assembly put the removed transition back.
    expect(keepsMachineEdit(edit, override(without, removed), spec)).toBe(false);
  });

  it("lets an assembly drop a scene the specification no longer has", () => {
    const edit = machine();
    const assembled = structuredClone(edit);
    delete (assembled.states as Record<string, unknown>).outro;
    expect(keepsMachineEdit(assembled, override(edit), { scenes: [{ id: "intro" }] })).toBe(true);
    expect(keepsMachineEdit(assembled, override(edit), spec)).toBe(false);
  });

  it("goes stale when the scenes change, not when a scene's words do", () => {
    const basis = documentBasis("stateMachine", { spec, mediaPlan: undefined });
    const reworded = {
      scenes: [
        { id: "intro", description: "Look closely" },
        { id: "outro", media: {} },
      ],
    };
    expect(documentBasis("stateMachine", { spec: reworded, mediaPlan: undefined })).toBe(basis);
    expect(
      documentBasis("stateMachine", {
        spec: { scenes: [...spec.scenes, { id: "extra" }] },
        mediaPlan: undefined,
      }),
    ).not.toBe(basis);
    expect(documentBasis("stateMachine", { spec: null, mediaPlan: undefined })).toBeNull();
  });

  it("is shared by every ref, as Loom keeps one machine per product", () => {
    expect(isSharedDocument("stateMachine")).toBe(true);
    expect(isSharedDocument("configuration")).toBe(false);
  });
});
