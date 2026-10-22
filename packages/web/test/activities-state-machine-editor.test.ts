/**
 * The state machine editor's states, without a DOM: where the machine came from, what keeps it
 * read-only, and which problems it lists — the saved machine's while the text is unchanged,
 * and only a check of the very text on screen once the author has typed.
 */
import { describe, expect, it } from "vitest";
import type { StateMachineCheck, StateMachineDocument } from "@prismshadow/penguin-server/api";
import {
  checkable,
  drawable,
  machineChanged,
  machineEditorView,
  machineOrigin,
  type MachineCheckState,
} from "../src/features/activities/state-machine-editor-model";
import { documentText } from "../src/features/activities/module-document";
import { S } from "../src/lib/strings";

const words = S.activities.stateMachineEditor;
const FILE = "generated/r1lt19L-v2/refs/r1lt19L-v2-1/spec/state-machine.json";
const machine = { version: "1.1", id: "demo", initial: "intro", states: { intro: {} } };
const inherited = {
  code: "activity.initial",
  path: "states.activity.initial",
  message: 'The "activity" compound state must use "complete" as its initial child.',
};

function document(overrides: Partial<StateMachineDocument> = {}): StateMachineDocument {
  return {
    productCode: "r1lt19L-v2",
    refNum: 1,
    definition: machine,
    validation: { valid: false, issues: [inherited] },
    source: "ref",
    file: FILE,
    edited: false,
    stale: false,
    editable: true,
    locked: null,
    canonicalRefNum: 1,
    ...overrides,
  };
}

const idle: MachineCheckState = { state: "idle" };
const saved = documentText(machine);
const typed = documentText({ ...machine, description: "Edited." });

describe("the state machine editor", () => {
  it("says where the machine came from", () => {
    expect(machineOrigin(document())).toBe(words.fromModule(FILE));
    expect(
      machineOrigin(document({ source: "product", file: "generated/x/spec/state-machine.json" })),
    ).toBe(words.fromProduct("generated/x/spec/state-machine.json"));
    expect(machineOrigin(document({ source: "draft", edited: true }))).toBe(words.fromDraft(FILE));
    expect(machineOrigin(document({ source: null, definition: null }))).toBe(words.missing);
  });

  it("opens on the saved machine, listing the problems it already has as not stopping a save", () => {
    const view = machineEditorView(document(), saved, idle, true);
    expect(view.saved).toBe(saved);
    expect(view.canEdit).toBe(true);
    expect(view.readOnly).toBeNull();
    expect(view.problems).toEqual({
      list: [
        {
          where: "states.activity.initial",
          message: inherited.message,
          inherited: true,
          warning: false,
        },
      ],
      unsaved: false,
      summary: words.problems(1, false),
      pending: false,
    });
  });

  it("says a saved machine with no problems has none", () => {
    const view = machineEditorView(
      document({ validation: { valid: true, issues: [] } }),
      saved,
      idle,
      true,
    );
    expect(view.problems).toMatchObject({ list: [], summary: words.noProblems, pending: false });
  });

  it("lists nothing for a ref with no machine yet, and lets one be written", () => {
    const empty = document({
      definition: null,
      source: null,
      validation: { valid: false, issues: [{ code: "machine.missing", path: "", message: "x" }] },
    });
    const view = machineEditorView(empty, "", idle, true);
    expect(view).toMatchObject({ saved: "", origin: words.missing, canEdit: true });
    expect(view.problems).toMatchObject({ list: [], summary: "", unsaved: false });
  });

  it("waits for the check of the typed text, and ignores a check of older text", () => {
    expect(machineEditorView(document(), typed, idle, true).problems).toMatchObject({
      unsaved: true,
      list: [],
      summary: "",
      pending: true,
    });
    expect(
      machineEditorView(document(), typed, { state: "checking", text: typed }, true).problems,
    ).toMatchObject({ summary: words.checking, pending: true });
    const older: StateMachineCheck = { valid: true, savable: true, issues: [] };
    expect(
      machineEditorView(document(), typed, { state: "done", text: saved, check: older }, true)
        .problems,
    ).toMatchObject({ list: [], pending: true });
  });

  it("lists the typed text's problems, new ones apart from those the saved machine had", () => {
    const check: StateMachineCheck = {
      valid: false,
      savable: false,
      issues: [
        {
          code: "scene.unknown",
          path: "states.outro",
          message: "Unknown outro.",
          inherited: false,
        },
        { code: "machine.type", path: "", message: "Whole file.", inherited: false },
        { ...inherited, inherited: true },
        {
          code: "implementation.missing",
          path: "present",
          message: "Not in the code.",
          inherited: false,
          warning: true,
        },
      ],
    };
    const view = machineEditorView(document(), typed, { state: "done", text: typed, check }, true);
    expect(view.problems).toEqual({
      list: [
        { where: "states.outro", message: "Unknown outro.", inherited: false, warning: false },
        { where: words.wholeFile, message: "Whole file.", inherited: false, warning: false },
        {
          where: "states.activity.initial",
          message: inherited.message,
          inherited: true,
          warning: false,
        },
        { where: "present", message: "Not in the code.", inherited: false, warning: true },
      ],
      unsaved: true,
      summary: words.problems(3, true),
      pending: false,
    });
  });

  it("says when the typed text has no problems, or could not be checked", () => {
    const clean: StateMachineCheck = { valid: true, savable: true, issues: [] };
    expect(
      machineEditorView(document(), typed, { state: "done", text: typed, check: clean }, true)
        .problems.summary,
    ).toBe(words.noProblems);
    expect(
      machineEditorView(
        document(),
        typed,
        { state: "failed", text: typed, reason: "offline" },
        true,
      ).problems,
    ).toMatchObject({ list: [], summary: words.checkFailed("offline"), pending: true });
  });

  it("shows an edit, and says when the specification moved on after it", () => {
    const view = machineEditorView(
      document({ source: "draft", edited: true, stale: true }),
      saved,
      idle,
      true,
    );
    expect(view).toMatchObject({ edited: true, stale: true, canEdit: true });
  });

  it("counts no warning as a problem", () => {
    const check: StateMachineCheck = {
      valid: true,
      savable: true,
      issues: [
        {
          code: "implementation.missing",
          path: "present",
          message: "Not in the code.",
          inherited: false,
          warning: true,
        },
      ],
    };
    const view = machineEditorView(document(), typed, { state: "done", text: typed, check }, true);
    expect(view.problems.summary).toBe(words.noProblems);
    expect(view.problems.list).toEqual([
      { where: "present", message: "Not in the code.", inherited: false, warning: true },
    ]);
  });

  it("sends nothing to check while the text only lays the saved machine out differently", () => {
    expect(machineChanged(JSON.stringify(machine), document())).toBe(false);
    expect(machineChanged(typed, document())).toBe(true);
    expect(machineChanged("", document({ definition: null }))).toBe(false);
  });

  it("keeps the machine every ref shares read-only on a ref that is not the canonical one", () => {
    expect(
      machineEditorView(
        document({ editable: false, locked: "shared", canonicalRefNum: 3 }),
        saved,
        idle,
        true,
      ),
    ).toMatchObject({ readOnly: words.shared(3), canEdit: false });
  });

  it("keeps a book's machine and a viewer who does not own the project read-only", () => {
    expect(
      machineEditorView(document({ editable: false, locked: "book" }), saved, idle, true),
    ).toMatchObject({ readOnly: words.book, canEdit: false });
    expect(machineEditorView(document({ editable: false }), saved, idle, true)).toMatchObject({
      readOnly: words.readOnly,
      canEdit: false,
    });
    // A draft not open here: nothing is said, and nothing can be changed.
    expect(machineEditorView(document(), saved, idle, false)).toMatchObject({
      readOnly: null,
      canEdit: false,
    });
  });

  it("checks only text that is a JSON object", () => {
    expect(checkable(typed)).toEqual({ ...machine, description: "Edited." });
    expect(checkable("{ broken")).toBeNull();
    expect(checkable("[]")).toBeNull();
    expect(checkable("null")).toBeNull();
  });

  it("draws the saved machine, an edit only once its check passes, and never text that does not parse", () => {
    const passed = (savable: boolean): MachineCheckState => ({
      state: "done",
      text: typed,
      check: { valid: savable, savable, issues: [] } as StateMachineCheck,
    });
    expect(drawable(saved, document(), idle)).toBe(true);
    expect(drawable(typed, document(), idle)).toBe(false);
    expect(drawable(typed, document(), { state: "checking", text: typed })).toBe(false);
    expect(drawable(typed, document(), passed(true))).toBe(true);
    expect(drawable(typed, document(), passed(false))).toBe(false);
    expect(drawable(`${typed}x`, document(), passed(true))).toBe(false);
    expect(drawable("{", document(), idle)).toBe(false);
  });
});
