/**
 * Loom's checks of an edited state machine, ported: a real Loom-written machine passes, and
 * each kind of problem is named with where in the file it is.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkStateMachine,
  machineSceneIds,
  validateStateMachine,
} from "../src/activities/state-machine-validation.js";

const REF = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/loom-state-machine/waf-module-r1lt19L-v2/generated/r1lt19L-v2/refs/r1lt19L-v2-1/spec",
);

const read = async (name: string) =>
  JSON.parse(await fs.readFile(path.join(REF, name), "utf8")) as Record<string, unknown>;

const spec = { scenes: [{ id: "intro", description: "Look" }] };

/** The smallest machine Loom accepts for `spec`. */
function machine(): Record<string, unknown> {
  return {
    version: "1.1",
    id: "demo",
    initial: "intro",
    states: {
      intro: {
        initial: "presenting",
        states: {
          presenting: {
            on: { "SCENE.COMPLETED": { target: "#demo.activity.complete" } },
          },
        },
      },
      activity: {
        initial: "complete",
        states: { complete: { type: "final", entry: { type: "finalizeActivity" } } },
      },
    },
  };
}

const codes = (value: unknown, scenes: unknown = spec) =>
  validateStateMachine(value, scenes).map((issue) => issue.code);

describe("state machine validation", () => {
  it("finds only the activity entry Loom's own later rule asks of a real ref's machine", async () => {
    // Loom wrote this machine before it required `activity` to start at `complete`; it plays.
    expect(
      validateStateMachine(await read("state-machine.json"), await read("activity_spec.json")),
    ).toEqual([expect.objectContaining({ code: "activity.initial" })]);
  });

  it("marks a problem the edited machine already had as inherited, and saves past it", async () => {
    const real = await read("state-machine.json");
    const realSpec = await read("activity_spec.json");
    const edited = structuredClone(real) as { states: Record<string, unknown> };
    edited.states["scene-99"] = {};
    const check = checkStateMachine(edited, realSpec, real);
    expect(check.savable).toBe(false);
    expect(check.issues.map((issue) => [issue.code, issue.inherited])).toEqual([
      ["scene.unknown", false],
      ["activity.initial", true],
    ]);
    expect(checkStateMachine(real, realSpec, real)).toMatchObject({ valid: false, savable: true });
  });

  it("passes the smallest valid machine", () => {
    expect(validateStateMachine(machine(), spec)).toEqual([]);
  });

  it("refuses what is not an object", () => {
    expect(codes([])).toEqual(["machine.type"]);
  });

  it("refuses parallel and history states before anything else", () => {
    const value = machine();
    (value.states as Record<string, Record<string, unknown>>).intro!.type = "parallel";
    expect(validateStateMachine(value, spec)).toEqual([
      expect.objectContaining({ code: "state.type.unsupported", path: "states.intro.type" }),
    ]);
  });

  it("names the schema's problems by where they are", () => {
    const value = machine();
    delete value.id;
    value.extra = true;
    value.version = "2.0";
    const states = value.states as Record<string, Record<string, unknown>>;
    states.intro!.colour = "red";
    states.intro!.entry = [];
    const issues = validateStateMachine(value, spec);
    expect(issues.every((issue) => issue.code === "schema.invalid")).toBe(true);
    expect(issues.map((issue) => issue.path).sort()).toEqual(
      ["extra", "id", "states.intro.colour", "states.intro.entry", "version"].sort(),
    );
  });

  it("finds unknown targets, a missing initial child and an unreachable transition", () => {
    const value = machine();
    const intro = (value.states as Record<string, Record<string, unknown>>).intro!;
    intro.initial = "waiting";
    intro.states = {
      presenting: {
        on: {
          "SCENE.COMPLETED": [{ target: "nowhere" }, { target: "#demo.activity.complete" }],
        },
      },
    };
    expect(codes(value)).toEqual([
      "state.initial.unknown",
      "transition.unreachable",
      "transition.target.unknown",
    ]);
  });

  it("resolves a sibling target beside its source state", () => {
    const value = machine();
    const intro = (value.states as Record<string, Record<string, unknown>>).intro!;
    intro.states = {
      presenting: { on: { NEXT: "asking" } },
      asking: { on: { "SCENE.COMPLETED": "#demo.activity.complete" } },
    };
    expect(validateStateMachine(value, spec)).toEqual([]);
  });

  it("asks for each scene of the specification and nothing else", () => {
    const value = machine();
    (value.states as Record<string, unknown>).outro = {};
    expect(validateStateMachine(value, { scenes: [{ id: "intro" }, { id: "middle" }] })).toEqual([
      expect.objectContaining({ code: "scene.missing", path: "states.middle" }),
      expect.objectContaining({ code: "scene.unknown", path: "states.outro" }),
    ]);
  });

  it("ends in a final activity.complete, entered at complete, and nowhere else", () => {
    const value = machine();
    const states = value.states as Record<string, Record<string, unknown>>;
    states.activity = { initial: "done", states: { done: { type: "final" } } };
    expect(codes(value)).toEqual([
      "state.final.location",
      "transition.target.unknown",
      "activity.complete",
      "activity.initial",
    ]);
  });

  it("refuses a watchdog delay that is not a positive whole number of milliseconds", () => {
    const value = machine();
    const presenting = (
      (value.states as Record<string, Record<string, unknown>>).intro!.states as Record<
        string,
        Record<string, unknown>
      >
    ).presenting!;
    presenting.after = { "0": "#demo.activity.complete" };
    expect(codes(value)).toEqual(["after.delay"]);
  });

  it("expects the scaffold's placeholder scene when the specification has none but the general one", () => {
    expect([...machineSceneIds({ scenes: [{ id: "general" }] })]).toEqual(["scaffold-placeholder"]);
    expect([...machineSceneIds(null)]).toEqual(["scaffold-placeholder"]);
    expect([...machineSceneIds({ stages: [{ id: "a" }, { id: "b", role: "general" }] })]).toEqual([
      "a",
    ]);
  });
});
