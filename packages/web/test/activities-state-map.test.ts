import { describe, expect, it } from "vitest";
import { machineOf, machineScenes, sceneMap } from "../src/features/activities/state-map";

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
    expect(machineOf({})).toBeNull();
    expect(machineOf({ stateMachine: { states: [] } })).toBeNull();
    expect(machineOf("nope")).toBeNull();
    expect(machineScenes(machineOf(configuration)!)).toEqual(["intro", "rocks"]);
  });

  it("lays a scene out from its first phase and marks the way back as a return", () => {
    const map = sceneMap(machineOf(configuration)!, "rocks")!;
    expect(map.nodes.map((node) => [node.id, node.depth, node.column, node.columns])).toEqual([
      ["idle", 0, 0, 1],
      ["prompt", 1, 0, 1],
      ["waiting", 2, 0, 1],
      ["retry", 3, 0, 2],
      ["correct", 3, 1, 2],
      ["orphan", 4, 0, 1],
    ]);
    expect(map.nodes.find((node) => node.id === "idle")).toMatchObject({ initial: true });
    expect(map.nodes.find((node) => node.id === "orphan")).toMatchObject({ final: true });
    expect(map.edges).toEqual([
      { from: "idle", to: "prompt", label: "after 500 ms", back: false },
      { from: "prompt", to: "waiting", label: "done", back: false },
      { from: "prompt", to: "waiting", label: "error", back: false },
      { from: "waiting", to: "correct", label: "CORRECT", back: false },
      { from: "waiting", to: "retry", label: "WRONG", back: false },
      { from: "retry", to: "waiting", label: "done", back: true },
    ]);
    expect(map.exits).toEqual([{ from: "correct", to: "#next-round", label: "done" }]);
  });

  it("has no map for a scene the machine does not define", () => {
    expect(sceneMap(machineOf(configuration)!, "missing")).toBeNull();
  });
});
