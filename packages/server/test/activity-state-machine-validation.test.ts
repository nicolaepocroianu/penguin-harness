/**
 * Loom's checks of an edited state machine, ported: a real Loom-written machine passes, and
 * each kind of problem is named with where in the file it is.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  checkStateMachine,
  implementationWarnings,
  machineImplementationNames,
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

/**
 * The player's own check, from the copy of Loom's package, loaded at run time: the package
 * compiles under its own settings, which this package's typecheck does not share.
 */
const runtime = {} as {
  validateStateMachineDefinition(value: unknown): { valid: boolean };
};
beforeAll(async () => {
  Object.assign(
    runtime,
    await import(
      pathToFileURL(
        path.resolve(
          import.meta.dirname,
          "../../waf-state-machine/src/state-machine/validation.ts",
        ),
      ).href
    ),
  );
});

describe("state machine validation", () => {
  it("passes nothing the player's own check refuses", async () => {
    const real = await read("state-machine.json");
    (real.states as Record<string, Record<string, unknown>>).activity!.initial = "complete";
    const leaf = machine();
    (
      (leaf.states as Record<string, Record<string, unknown>>).intro!.states as Record<
        string,
        Record<string, unknown>
      >
    ).presenting!.initial = "x";
    for (const [value, scenes, valid] of [
      [real, await read("activity_spec.json"), true],
      [machine(), spec, true],
      [leaf, spec, false],
    ] as const) {
      expect(runtime.validateStateMachineDefinition(value).valid).toBe(valid);
      expect(validateStateMachine(value, scenes).length === 0).toBe(valid);
    }
  });

  it("finds only the activity entry Loom's own later rule asks of a real ref's machine", async () => {
    // Loom wrote this machine before it required `activity` to start at `complete`; it plays.
    expect(
      validateStateMachine(await read("state-machine.json"), await read("activity_spec.json")),
    ).toEqual([expect.objectContaining({ code: "activity.initial" })]);
  });

  it("never lets a schema problem the saved machine had hide the edit's new ones", async () => {
    const real = await read("state-machine.json");
    const realSpec = await read("activity_spec.json");
    const baseline = { ...structuredClone(real), notes: "kept by hand" } as Record<string, unknown>;
    const edited = structuredClone(baseline) as { states: Record<string, Record<string, unknown>> };
    delete (edited.states.activity!.states as Record<string, unknown>).complete;
    edited.states["scene-1"]!.on = { GO: "nowhere" };
    delete edited.states["scene-2"];
    const check = checkStateMachine(edited, realSpec, baseline);
    expect(check.savable).toBe(false);
    const added = check.issues.filter((issue) => !issue.inherited);
    expect(new Set(added.map((issue) => issue.code))).toEqual(
      new Set(["transition.target.unknown", "scene.missing", "activity.complete"]),
    );
    expect(added).toContainEqual(
      expect.objectContaining({ path: "states.scene-1.on.GO.0.target" }),
    );
    // Only the hand-kept key was there before, and it hides nothing.
    expect(check.issues.filter((issue) => issue.inherited).map((issue) => issue.path)).toEqual([
      "notes",
      "states.activity.initial",
    ]);
  });

  it("never lets an unsupported state the saved machine had hide the edit's schema problems", () => {
    const baseline = machine();
    (baseline.states as Record<string, Record<string, unknown>>).intro!.type = "history";
    const edited = structuredClone(baseline);
    edited.version = "9";
    (edited.states as Record<string, Record<string, unknown>>).intro!.colour = "red";
    const check = checkStateMachine(edited, spec, baseline);
    expect(check.savable).toBe(false);
    expect(check.issues.filter((issue) => !issue.inherited).map((issue) => issue.path)).toEqual([
      "version",
      "states.intro.colour",
    ]);
  });

  it("names every implementation a machine uses", async () => {
    const value = machine();
    const states = value.states as Record<string, Record<string, unknown>>;
    states.intro!.entry = ["present", { type: "track", params: {} }];
    states.intro!.on = { NEXT: { guard: "ready", actions: "cleanup", target: "intro" } };
    states.intro!.states = {
      presenting: { invoke: { src: "load", onDone: { actions: ["done"] } } },
    };
    expect(machineImplementationNames(value)).toEqual([
      "cleanup",
      "done",
      "finalizeActivity",
      "load",
      "present",
      "ready",
      "track",
    ]);
    expect(machineImplementationNames(await read("state-machine.json"))).toHaveLength(21);
  });

  it("warns of each implementation the module's code never mentions, without refusing", () => {
    const value = machine();
    const warnings = implementationWarnings(value, "export const actions = { present() {} };");
    expect(warnings).toEqual([
      expect.objectContaining({
        code: "implementation.missing",
        path: "finalizeActivity",
        warning: true,
      }),
    ]);
    const check = checkStateMachine(value, spec, null, warnings);
    expect(check).toMatchObject({ valid: true, savable: true });
    expect(check.issues).toHaveLength(1);
    expect(implementationWarnings(value, "'finalizeActivity': finalize")).toEqual([]);
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

  it("refuses parallel and history states first, and still checks the rest", () => {
    const value = machine();
    const states = value.states as Record<string, Record<string, unknown>>;
    states.intro!.type = "parallel";
    states.intro!.initial = "nowhere";
    expect(codes(value)).toEqual([
      "state.type.unsupported",
      "schema.invalid",
      "state.initial.unknown",
    ]);
  });

  it("finds a leaf's initial child, which the player refuses", () => {
    const value = machine();
    const presenting = (
      (value.states as Record<string, Record<string, unknown>>).intro!.states as Record<
        string,
        Record<string, unknown>
      >
    ).presenting!;
    presenting.initial = "x";
    expect(validateStateMachine(value, spec)).toEqual([
      expect.objectContaining({
        code: "state.initial.unknown",
        path: "states.intro.presenting.initial",
      }),
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
    expect(
      issues
        .filter((issue) => issue.code === "schema.invalid")
        .map((issue) => issue.path)
        .sort(),
    ).toEqual(["extra", "id", "states.intro.colour", "states.intro.entry", "version"].sort());
    // With no id, the absolute target `#demo.` names nothing: every stage still runs.
    expect(issues.filter((issue) => issue.code !== "schema.invalid")).toEqual([
      expect.objectContaining({ code: "transition.target.unknown" }),
    ]);
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
