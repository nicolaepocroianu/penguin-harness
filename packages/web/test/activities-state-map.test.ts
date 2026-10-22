import { describe, expect, it } from "vitest";
import {
  MAP_ZOOM,
  fitZoom,
  machineDefinition,
  machineOf,
  machineScenes,
  phaseDetails,
  sceneMap,
  stepZoom,
} from "../src/features/activities/state-map";

const configuration = {
  stateMachine: {
    version: "1.1",
    id: "letters",
    initial: "intro",
    states: {
      activity: { type: "compound" },
      intro: {
        initial: "playing",
        states: { playing: { invoke: { src: "playVideo", onDone: "#rocks" } } },
      },
      rocks: {
        initial: "idle",
        states: {
          idle: { after: { "500": "prompt" } },
          prompt: { invoke: { src: "say", onDone: "waiting", onError: "waiting" } },
          waiting: {
            entry: ["highlight", { type: "listen" }],
            exit: "stopListening",
            on: {
              CORRECT: { target: "correct", actions: "stopHighlight" },
              WRONG: "retry",
              HINT: {},
            },
          },
          retry: { invoke: { src: "say", onDone: "rocks.waiting" } },
          correct: { invoke: { src: "chest", onDone: "#next-round" } },
          orphan: { type: "final" },
        },
      },
    },
  },
};

describe("the behavior map", () => {
  it("reads a module's machine, including the older key, and nothing that is not one", () => {
    expect(machineOf(configuration)?.initial).toBe("intro");
    expect(machineOf({ activityMachine: configuration.stateMachine })?.initial).toBe("intro");
    // A generated module keeps its configuration under its product code.
    expect(
      machineOf({ resolution: "640x480", test21: { telemetry: false, ...configuration } })?.initial,
    ).toBe("intro");
    expect(machineOf({})).toBeNull();
    expect(machineOf({ stateMachine: { states: [] } })).toBeNull();
    expect(machineOf("nope")).toBeNull();
    expect(machineScenes(machineOf(configuration)!)).toEqual(["intro", "rocks"]);
  });

  it("reads a scene's phases, the transitions between them and those that leave it", () => {
    const map = sceneMap(machineOf(configuration)!, "rocks")!;
    expect(map.nodes.map((node) => node.id)).toEqual([
      "idle",
      "prompt",
      "waiting",
      "retry",
      "correct",
      "orphan",
    ]);
    expect(map.nodes.find((node) => node.id === "idle")).toMatchObject({ initial: true });
    expect(map.nodes.find((node) => node.id === "orphan")).toMatchObject({ final: true });
    expect(map.edges).toEqual([
      { from: "idle", to: "prompt", trigger: { kind: "after", ms: "500" } },
      { from: "prompt", to: "waiting", trigger: { kind: "done" } },
      { from: "prompt", to: "waiting", trigger: { kind: "error" } },
      { from: "waiting", to: "correct", trigger: { kind: "event", name: "CORRECT" } },
      { from: "waiting", to: "retry", trigger: { kind: "event", name: "WRONG" } },
      { from: "retry", to: "waiting", trigger: { kind: "done" } },
    ]);
    expect(map.exits).toEqual([{ from: "correct", to: "#next-round", trigger: { kind: "done" } }]);
  });

  it("has no map for a scene the machine does not define", () => {
    expect(sceneMap(machineOf(configuration)!, "missing")).toBeNull();
  });
});

describe("inspecting a phase", () => {
  const machine = machineOf(configuration)!;
  it("says what a phase does on entry and exit, and how it is reached and left", () => {
    const details = phaseDetails(machine, "rocks", "waiting")!;
    expect(details.entry).toEqual(["highlight", "listen"]);
    expect(details.exit).toEqual(["stopListening"]);
    expect(details.incoming.map((edge) => edge.from)).toEqual(["prompt", "prompt", "retry"]);
    expect(details.outgoing.map((edge) => edge.to)).toEqual(["correct", "retry"]);
    const correct = phaseDetails(machine, "rocks", "correct")!;
    expect(correct.invokes).toEqual(["chest"]);
    expect(correct.outgoing).toEqual([
      { trigger: { kind: "done" }, to: "next-round", leaves: true },
    ]);
    expect(phaseDetails(machine, "rocks", "orphan")).toMatchObject({ final: true, incoming: [] });
    expect(phaseDetails(machine, "rocks", "missing")).toBeNull();
  });

  it("zooms in Loom's steps, holds at either end, and fits the column without passing 120%", () => {
    expect(stepZoom(1, 1)).toBe(1.15);
    expect(stepZoom(1, -1)).toBe(0.85);
    expect(stepZoom(MAP_ZOOM.max, 1)).toBe(MAP_ZOOM.max);
    expect(stepZoom(MAP_ZOOM.min, -1)).toBe(MAP_ZOOM.min);
    expect(fitZoom(344, 688)).toBe(0.5);
    expect(fitZoom(2000, 500)).toBe(1.2);
    expect(fitZoom(10, 1000)).toBe(MAP_ZOOM.min);
    expect(fitZoom(0, 500)).toBeNull();
  });

  it("hands the layout only what has the shape Loom's model describes", () => {
    const definition = machineDefinition(
      machineOf({
        stateMachine: {
          id: "letters",
          initial: "rocks",
          states: {
            rocks: {
              initial: "waiting",
              states: {
                waiting: {
                  entry: ["highlight", { type: "listen" }, 3],
                  on: { CORRECT: [{ target: "done", guard: { type: "isCorrect" } }, 7], HINT: {} },
                  invoke: { src: { type: "say" }, onDone: "done" },
                },
                done: { type: "final" },
                broken: "not a state",
              },
            },
          },
        },
      })!,
    );
    expect(definition.id).toBe("letters");
    const rocks = definition.states.rocks!.states!;
    expect(Object.keys(rocks)).toEqual(["waiting", "done"]);
    expect(rocks.waiting).toEqual({
      entry: ["highlight", { type: "listen" }],
      on: { CORRECT: [{ target: "done", guard: { type: "isCorrect" } }], HINT: [{}] },
      invoke: { src: "say", onDone: ["done"] },
    });
    expect(rocks.done).toEqual({ type: "final" });
  });
});
