/**
 * Loom's layout tests (waf-loom `state-machine-graph.spec.ts`), ported with the layout they test.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  StateMachineGraphLayout,
  StateMachineLayoutEdge,
  StateMachineLayoutNode,
  buildStateMachineGraph,
  layoutStateMachine,
  layoutStateMachineGroup,
  layoutAllScenesStateMachine,
  type StateMachineDefinition,
} from "../src/features/activities/state-machine-graph";

type Segment = [number, number, number, number];
type StateDefinition = StateMachineDefinition["states"][string];

/** Corner-to-corner straight runs of an orthogonal path (quadratic corners collapse to their end point). */
function pathSegments(path: string): Segment[] {
  const points: Array<[number, number]> = [];
  for (const command of path.match(/[MLQ][^MLQ]*/g) ?? []) {
    const values = command
      .slice(1)
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    points.push(command[0] === "Q" ? [values[2]!, values[3]!] : [values[0]!, values[1]!]);
  }
  return points
    .slice(1)
    .map((point, index) => [points[index]![0], points[index]![1], point[0], point[1]]);
}

function assertOrthogonalPath(path: string): void {
  assert.match(
    path,
    /^M [\d.-]+ [\d.-]+( (L [\d.-]+ [\d.-]+|Q [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+))+$/,
  );
  for (const [x1, y1, x2, y2] of pathSegments(path)) {
    assert.ok(
      Math.abs(x1 - x2) < 8.5 || Math.abs(y1 - y2) < 8.5,
      `segment ${x1},${y1} -> ${x2},${y2} is axis-aligned`,
    );
  }
}

function arrowTip(edge: StateMachineLayoutEdge): { x: number; y: number } {
  const match = /^M ([\d.-]+) ([\d.-]+)/.exec(edge.arrowPath);
  assert.ok(match, `edge ${edge.id} has an arrowhead`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function boxesOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function labelBox(edge: StateMachineLayoutEdge): Rect {
  return {
    x: edge.labelX - edge.labelWidth / 2,
    y: edge.labelY - edge.labelHeight / 2,
    width: edge.labelWidth,
    height: edge.labelHeight,
  };
}

/**
 * Edges never run through states they do not connect, parallel edges never share a run,
 * every arrowhead tip sits on its target's border, and label pills overlap neither states nor each other.
 */
function assertCleanGeometry(layout: StateMachineGraphLayout): void {
  const nodeById = new Map(layout.nodes.map((node) => [node.id, node]));
  const runs = layout.edges.flatMap((edge) =>
    pathSegments(edge.path).map((segment) => ({ edge, segment })),
  );
  for (const {
    edge,
    segment: [x1, y1, x2, y2],
  } of runs) {
    for (const node of layout.nodes) {
      if (node.id === edge.sourceId || node.id === edge.targetId) continue;
      const crosses =
        Math.max(x1, x2) > node.x + 1 &&
        Math.min(x1, x2) < node.x + node.width - 1 &&
        Math.max(y1, y2) > node.y + 1 &&
        Math.min(y1, y2) < node.y + node.height - 1;
      assert.ok(!crosses, `edge ${edge.id} runs through ${node.id}`);
    }
  }
  for (let i = 0; i < runs.length; i += 1) {
    for (let j = i + 1; j < runs.length; j += 1) {
      if (runs[i]!.edge === runs[j]!.edge) continue;
      const [a1, b1, a2, b2] = runs[i]!.segment;
      const [c1, d1, c2, d2] = runs[j]!.segment;
      if (a1 === a2 && c1 === c2 && Math.abs(a1 - c1) < 1) {
        const overlap =
          Math.min(Math.max(b1, b2), Math.max(d1, d2)) -
          Math.max(Math.min(b1, b2), Math.min(d1, d2));
        assert.ok(overlap <= 2, `${runs[i]!.edge.id} and ${runs[j]!.edge.id} share a vertical run`);
      }
      if (b1 === b2 && d1 === d2 && Math.abs(b1 - d1) < 1) {
        const overlap =
          Math.min(Math.max(a1, a2), Math.max(c1, c2)) -
          Math.max(Math.min(a1, a2), Math.min(c1, c2));
        assert.ok(
          overlap <= 2,
          `${runs[i]!.edge.id} and ${runs[j]!.edge.id} share a horizontal run`,
        );
      }
    }
  }
  for (const edge of layout.edges) {
    if (edge.kind === "stub" || edge.kind === "self") continue;
    const target = nodeById.get(edge.targetId) as StateMachineLayoutNode;
    const tip = arrowTip(edge);
    const onSide =
      (Math.abs(tip.x - target.x) < 0.6 || Math.abs(tip.x - target.x - target.width) < 0.6) &&
      tip.y >= target.y &&
      tip.y <= target.y + target.height;
    const onTopOrBottom =
      (Math.abs(tip.y - target.y) < 0.6 || Math.abs(tip.y - target.y - target.height) < 0.6) &&
      tip.x >= target.x &&
      tip.x <= target.x + target.width;
    assert.ok(onSide || onTopOrBottom, `arrowhead of ${edge.id} sits on ${target.id}'s border`);
  }
  const labelled = layout.edges.filter((edge) => edge.label && edge.labelWidth > 0);
  for (const [index, edge] of labelled.entries()) {
    for (const node of layout.nodes) {
      assert.ok(!boxesOverlap(labelBox(edge), node), `label of ${edge.id} overlaps ${node.id}`);
    }
    for (const other of labelled.slice(index + 1)) {
      assert.ok(
        !boxesOverlap(labelBox(edge), labelBox(other)),
        `labels of ${edge.id} and ${other.id} overlap`,
      );
    }
  }
}

/** A read-along book page with a word-audio interruption, shaped like the generated book machines. */
function bookPage(id: string, previous: string | null, next: string | null): StateDefinition {
  return {
    initial: "narrating",
    states: {
      narrating: {
        on: {
          "NARRATION.COMPLETED": { target: "ready" },
          "WORD.TAPPED": {
            guard: { type: "canTapWords", params: { sceneId: id } },
            target: "word-audio",
          },
        },
      },
      ready: {
        on: {
          "NARRATION.PLAY": { target: "narrating" },
          "PAGE.NEXT": next
            ? {
                guard: { type: "hasHeardNarration", params: { sceneId: id } },
                target: `#book.${next}`,
              }
            : { target: "#book.activity.complete" },
          ...(previous ? { "PAGE.PREVIOUS": { target: `#book.${previous}.ready` } } : {}),
          "WORD.TAPPED": {
            guard: { type: "canTapWords", params: { sceneId: id } },
            target: "word-audio",
          },
        },
      },
      "word-audio": {
        on: {
          "WORD.AUDIO_COMPLETED": [
            {
              guard: { type: "returnsToReaderState", params: { sceneId: id, state: "narrating" } },
              target: "narrating",
            },
            { target: "ready" },
          ],
        },
      },
    },
  };
}

const bookDefinition: StateMachineDefinition = {
  version: "1.1",
  id: "book",
  initial: "page-1",
  states: {
    "page-1": bookPage("page-1", null, "page-2"),
    "page-2": bookPage("page-2", "page-1", "page-3"),
    "page-3": bookPage("page-3", "page-2", null),
    activity: { initial: "complete", states: { complete: { type: "final" } } },
  },
};

describe("buildStateMachineGraph", () => {
  it("groups nested states and exposes invoked and event transitions", () => {
    const definition: StateMachineDefinition = {
      version: "1.0",
      id: "lesson",
      initial: "scene-1",
      states: {
        "scene-1": {
          initial: "presenting",
          states: {
            presenting: {
              invoke: { src: "renderScene", onDone: { target: "prompting", guard: "ready" } },
            },
            prompting: { on: { NEXT: "#lesson.activity.complete" } },
          },
        },
        activity: { states: { complete: { type: "final" } } },
      },
    };

    const graph = buildStateMachineGraph(definition);

    assert.equal(graph[0]!.id, "scene-1");
    assert.equal(graph[0]!.nodes[0]!.id, "scene-1.presenting");
    assert.equal(graph[0]!.nodes[0]!.initial, true);
    assert.deepEqual(graph[0]!.nodes[0]!.transitions, [
      { event: "done", guard: "ready", target: "prompting", targetId: "scene-1.prompting" },
    ]);
    assert.equal(graph[1]!.nodes[0]!.final, true);
  });

  it("includes watchdog transitions with their delay", () => {
    const definition: StateMachineDefinition = {
      version: "1.1",
      id: "lesson",
      initial: "scene-1",
      states: {
        "scene-1": {
          initial: "waiting",
          states: {
            waiting: { after: { 5000: { target: "recovering" } } },
            recovering: {},
          },
        },
      },
    };

    const group = buildStateMachineGraph(definition)[0]!;
    const transition = group.nodes[0]!.transitions[0];
    const layout = layoutStateMachineGroup(group);

    assert.deepEqual(transition, {
      event: "after 5000 ms",
      guard: "",
      target: "recovering",
      targetId: "scene-1.recovering",
    });
    assert.equal(layout.edges[0]!.label, "After 5000 ms");
  });

  it("lays guarded and fallback branches out as distinct directed edges", () => {
    const definition: StateMachineDefinition = {
      version: "1.0",
      id: "lesson",
      initial: "scene-1",
      states: {
        "scene-1": {
          initial: "first-choice",
          states: {
            "first-choice": {
              invoke: {
                src: "awaitSelection",
                onDone: [
                  { guard: "selectedChoiceCorrect", target: "correct-feedback" },
                  { target: "first-incorrect-feedback" },
                ],
              },
            },
            "first-incorrect-feedback": { on: { NEXT: "correct-feedback" } },
            "correct-feedback": { type: "final" },
          },
        },
      },
    };

    const group = buildStateMachineGraph(definition)[0]!;
    const layout = layoutStateMachineGroup(group);
    const branchEdges = layout.edges.filter((edge) => edge.sourceId === "scene-1.first-choice");

    assert.equal(branchEdges.length, 2);
    assert.equal(branchEdges[0]!.label, "[correct]");
    assert.equal(branchEdges[0]!.guarded, true);
    assert.equal(branchEdges[1]!.label, "else");
    assert.equal(branchEdges[1]!.fallback, true);
    assert.notEqual(branchEdges[0]!.path, branchEdges[1]!.path);
    // Edges are orthogonal polylines with rounded corners (no free-form bezier curves).
    assertOrthogonalPath(branchEdges[0]!.path);
    assertOrthogonalPath(branchEdges[1]!.path);
    assertCleanGeometry(layout);
    assert.equal(layout.nodes.find((node) => node.id === "scene-1.first-choice")?.lane, "flow");
    assert.equal(
      layout.nodes.find((node) => node.id === "scene-1.first-incorrect-feedback")?.lane,
      "retry",
    );
    assert.equal(
      layout.nodes.find((node) => node.id === "scene-1.correct-feedback")?.lane,
      "outcome",
    );
    assert.ok(
      (layout.nodes.find((node) => node.id === "scene-1.first-incorrect-feedback")?.x ?? 0) <
        (layout.nodes.find((node) => node.id === "scene-1.first-choice")?.x ?? 0),
    );
    assert.ok(
      (layout.nodes.find((node) => node.id === "scene-1.correct-feedback")?.x ?? 0) >
        (layout.nodes.find((node) => node.id === "scene-1.first-choice")?.x ?? 0),
    );
    assert.equal(
      layout.nodes.find((node) => node.id === "scene-1.correct-feedback")?.y,
      layout.nodes.find((node) => node.id === "scene-1.first-choice")?.y,
    );
    assert.deepEqual(
      layout.lanes.map((lane) => lane.label),
      ["Recovery path", "State flow", "Happy path"],
    );
  });

  it("labels a correlation-guarded recovery choice branch as incorrect", () => {
    const definition: StateMachineDefinition = {
      version: "1.1",
      id: "lesson",
      initial: "scene-1",
      states: {
        "scene-1": {
          initial: "first-choice",
          states: {
            "first-choice": {
              on: {
                "CHOICE.SELECTED": [
                  {
                    guard: { type: "isCorrectChoiceForScene" },
                    target: "correct-feedback",
                  },
                  {
                    guard: { type: "isEventForScene" },
                    target: "first-incorrect-feedback",
                  },
                ],
              },
            },
            "first-incorrect-feedback": {},
            "correct-feedback": {},
          },
        },
      },
    };

    const group = buildStateMachineGraph(definition)[0]!;
    const layout = layoutStateMachineGroup(group);
    const recoveryEdge = layout.edges.find(
      (edge) => edge.targetId === "scene-1.first-incorrect-feedback",
    );

    assert.equal(recoveryEdge?.fallback, true);
    assert.equal(recoveryEdge?.label, "[incorrect]");
  });

  it("centers a compact three-lane graph instead of stretching branches to the viewport edges", () => {
    const definition: StateMachineDefinition = {
      version: "1.1",
      id: "lesson",
      initial: "scene-1",
      states: {
        "scene-1": {
          states: {
            choice: {
              on: {
                SELECTED: [{ guard: "correct", target: "success" }, { target: "retry" }],
                SKIP: "complete",
              },
            },
            retry: { on: { AGAIN: "choice" } },
            success: { on: { DONE: "complete" } },
            complete: { on: { NEXT: "#lesson.scene-2.ready" } },
          },
        },
        "scene-2": {
          states: {
            ready: {},
          },
        },
      },
    };

    const group = buildStateMachineGraph(definition)[0]!;
    const layout = layoutStateMachineGroup(group, 960);
    const flowNode = layout.nodes.find((node) => node.id === "scene-1.choice");
    const retryNode = layout.nodes.find((node) => node.id === "scene-1.retry");
    const outcomeNode = layout.nodes.find((node) => node.id === "scene-1.success");
    const completionNode = layout.nodes.find((node) => node.id === "scene-1.complete");
    const externalNode = layout.nodes.find((node) => node.id === "scene-2.ready");

    assert.equal(layout.width, 960);
    assert.ok((retryNode?.x ?? 0) > 50);
    assert.ok((outcomeNode?.x ?? 960) < 900);
    assert.ok((outcomeNode?.x ?? 0) - (retryNode?.x ?? 0) <= 600);
    assert.ok((retryNode?.x ?? 0) < (flowNode?.x ?? 0));
    assert.ok((flowNode?.x ?? 0) < (outcomeNode?.x ?? 0));
    assert.equal(completionNode?.lane, "outcome");
    assert.equal(externalNode?.lane, "outcome");
    assertOrthogonalPath(layout.edges.find((edge) => edge.fallback)?.path ?? "");
    assertCleanGeometry(layout);
  });

  it("keeps correlation guards in flow and separates machine10 success and recovery paths", () => {
    const correlated = (target: string) => ({
      guard: { type: "isEventForScene", params: { sceneId: "scene-9" } },
      target,
    });
    const definition: StateMachineDefinition = {
      version: "1.1",
      id: "lesson",
      initial: "scene-9",
      states: {
        "scene-9": {
          initial: "presenting",
          states: {
            presenting: {
              on: {
                "SCENE.PRESENTED": correlated("awaiting-choice"),
                "EFFECT.FAILED": correlated("#lesson.activity.error"),
              },
            },
            "awaiting-choice": {
              on: {
                "CHOICE.SELECTED": [
                  { guard: { type: "isCorrectSelection" }, target: "correct-feedback" },
                  { guard: { type: "isIncorrectSelection" }, target: "first-incorrect-feedback" },
                ],
              },
            },
            "first-incorrect-feedback": {
              on: { "FEEDBACK.COMPLETED": correlated("retry-choice") },
            },
            "retry-choice": {
              on: {
                "CHOICE.SELECTED": [
                  { guard: { type: "isCorrectSelection" }, target: "correct-feedback" },
                  { guard: { type: "isIncorrectSelection" }, target: "guided-feedback" },
                ],
              },
            },
            "guided-feedback": {
              on: { "FEEDBACK.COMPLETED": correlated("guided-choice") },
            },
            "guided-choice": {
              on: {
                "CHOICE.SELECTED": {
                  guard: { type: "isCorrectSelection" },
                  target: "correct-feedback",
                },
              },
            },
            "correct-feedback": {
              on: { "FEEDBACK.COMPLETED": correlated("collecting-treasure") },
            },
            "collecting-treasure": {
              on: { "SCENE.COMPLETED": correlated("#lesson.scene-10.presenting") },
            },
          },
        },
        "scene-10": { states: { presenting: {} } },
        activity: { states: { error: {} } },
      },
    };

    const group = buildStateMachineGraph(definition)[0]!;
    const layout = layoutStateMachineGroup(group, 1600);
    const laneFor = (suffix: string) => layout.nodes.find((node) => node.id.endsWith(suffix))?.lane;

    assert.equal(laneFor("scene-9.presenting"), "flow");
    assert.equal(laneFor("scene-9.awaiting-choice"), "flow");
    assert.equal(laneFor("scene-9.first-incorrect-feedback"), "retry");
    assert.equal(laneFor("scene-9.retry-choice"), "retry");
    assert.equal(laneFor("scene-9.guided-feedback"), "retry");
    assert.equal(laneFor("scene-9.guided-choice"), "retry");
    assert.equal(laneFor("scene-9.correct-feedback"), "outcome");
    assert.equal(laneFor("scene-9.collecting-treasure"), "outcome");
    assert.equal(laneFor("scene-10.presenting"), "outcome");
    assert.equal(laneFor("activity.error"), "retry");
    assert.ok(layout.lanes.at(-1)!.x - layout.lanes[0]!.x <= 600);
    const correctY = layout.nodes.find((node) => node.id === "scene-9.correct-feedback")!.y;
    const collectingY = layout.nodes.find((node) => node.id === "scene-9.collecting-treasure")!.y;
    assert.equal(collectingY - correctY, 124);
    assert.ok(layout.edges.filter((edge) => edge.exception).every((edge) => edge.label === ""));
    assertCleanGeometry(layout);
    assert.equal(
      layout.edges.find((edge) => edge.targetId.endsWith("first-incorrect-feedback"))?.label,
      "[incorrect]",
    );
  });

  it("splits camelCase guards and humanizes standard domain guards cleanly", () => {
    const definition: StateMachineDefinition = {
      version: "1.1",
      id: "lesson",
      initial: "scene-1",
      states: {
        "scene-1": {
          initial: "choice",
          states: {
            choice: {
              on: {
                "CHOICE.SELECTED": [
                  { guard: "hasGuidedChoiceForScene", target: "guided-feedback" },
                  { guard: "isHangupEventForScene", target: "hangup-state" },
                  { guard: "customActionRequired", target: "custom-state" },
                ],
              },
            },
            "guided-feedback": {},
            "hangup-state": {},
            "custom-state": {},
          },
        },
      },
    };

    const group = buildStateMachineGraph(definition)[0]!;
    const layout = layoutStateMachineGroup(group);

    const guidedEdge = layout.edges.find((e) => e.targetId === "scene-1.guided-feedback");
    const hangupEdge = layout.edges.find((e) => e.targetId === "scene-1.hangup-state");
    const customEdge = layout.edges.find((e) => e.targetId === "scene-1.custom-state");

    assert.equal(guidedEdge?.label, "[guided choice]");
    assert.equal(hangupEdge?.label, "[hang up]");
    assert.equal(customEdge?.label, "[custom action required]");
  });

  it("resolves anchored cross-scene targets and draws an external destination node", () => {
    const definition: StateMachineDefinition = {
      version: "1.0",
      id: "lesson",
      initial: "scene-1",
      states: {
        "scene-1": {
          states: {
            completing: { on: { NEXT: "#lesson.scene-2.preparing" } },
          },
        },
        "scene-2": {
          states: {
            preparing: {},
          },
        },
      },
    };

    const group = buildStateMachineGraph(definition)[0]!;
    const layout = layoutStateMachineGroup(group);

    assert.equal(group.nodes[0]!.transitions[0]!.targetId, "scene-2.preparing");
    assert.equal(layout.nodes.at(-1)?.id, "scene-2.preparing");
    assert.equal(layout.nodes.at(-1)?.external, true);
    assert.equal(layout.edges[0]!.targetId, "scene-2.preparing");
  });

  it("renders v1.1 entry actions and descriptor guards from event-driven states", () => {
    const definition: StateMachineDefinition = {
      version: "1.1",
      id: "lesson",
      initial: "scene-1",
      states: {
        "scene-1": {
          initial: "first-choice",
          states: {
            "first-choice": {
              entry: { type: "choice.enable", params: { attempt: 1 } },
              on: {
                "CHOICE.SELECTED": [
                  {
                    guard: { type: "choice.isCorrect", params: { expected: "A" } },
                    target: "correct-feedback",
                  },
                  { target: "first-incorrect-feedback" },
                ],
              },
            },
            "first-incorrect-feedback": {},
            "correct-feedback": {},
          },
        },
      },
    };

    const group = buildStateMachineGraph(definition)[0]!;

    assert.deepEqual(group.nodes[0]!.actions, ["choice.enable"]);
    assert.equal(group.nodes[0]!.label, "Choice 1");
    assert.equal(group.nodes[0]!.service, "");
    assert.deepEqual(group.nodes[0]!.transitions, [
      {
        event: "CHOICE.SELECTED",
        guard: "choice.isCorrect",
        target: "correct-feedback",
        targetId: "scene-1.correct-feedback",
      },
      {
        event: "CHOICE.SELECTED",
        guard: "",
        target: "first-incorrect-feedback",
        targetId: "scene-1.first-incorrect-feedback",
      },
    ]);
  });

  it("renders deeply nested states and resolves transitions relative to their real parent", () => {
    const definition: StateMachineDefinition = {
      version: "1.1",
      id: "lesson",
      initial: "scene-1",
      states: {
        "scene-1": {
          initial: "round",
          states: {
            round: {
              initial: "prompting",
              states: {
                prompting: { on: { NEXT: "answering" } },
                answering: {},
              },
            },
          },
        },
      },
    };

    const group = buildStateMachineGraph(definition)[0]!;
    const prompting = group.nodes.find((node) => node.id === "scene-1.round.prompting");

    assert.deepEqual(
      group.nodes.map((node) => node.id),
      ["scene-1.round", "scene-1.round.prompting", "scene-1.round.answering"],
    );
    assert.equal(prompting?.initial, true);
    assert.equal(prompting?.transitions[0]?.targetId, "scene-1.round.answering");
  });

  it("lays out all scenes in a single continuous connected graph with scene cluster headers", () => {
    const definition: StateMachineDefinition = {
      version: "1.1",
      id: "lesson",
      initial: "scene-1",
      states: {
        "scene-1": {
          initial: "prompting",
          states: {
            prompting: { on: { NEXT: "answering" } },
            answering: { on: { DONE: "#lesson.scene-2.prompting" } },
          },
        },
        "scene-2": {
          initial: "prompting",
          states: {
            prompting: { on: { COMPLETE: "#lesson.activity.finish" } },
          },
        },
        activity: {
          states: {
            finish: { type: "final" },
          },
        },
      },
    };

    const groups = buildStateMachineGraph(definition);
    const layout = layoutAllScenesStateMachine(groups, 1000);

    // All states across all 3 scene groups are present
    assert.equal(layout.nodes.length, 4);
    assert.ok(layout.nodes.some((n) => n.id === "scene-1.prompting"));
    assert.ok(layout.nodes.some((n) => n.id === "scene-1.answering"));
    assert.ok(layout.nodes.some((n) => n.id === "scene-2.prompting"));
    assert.ok(layout.nodes.some((n) => n.id === "activity.finish"));

    // Scene sections are generated
    assert.equal(layout.scenes?.length, 3);
    assert.equal(layout.scenes?.[0]?.id, "scene-1");
    assert.equal(layout.scenes?.[1]?.id, "scene-2");
    assert.equal(layout.scenes?.[2]?.id, "activity");

    // Inter-scene edge links directly between scene 1 and scene 2
    const crossSceneEdge = layout.edges.find(
      (e) => e.sourceId === "scene-1.answering" && e.targetId === "scene-2.prompting",
    );
    assert.ok(crossSceneEdge);

    // layoutStateMachine with 'all' matches layoutAllScenesStateMachine
    const unifiedLayout = layoutStateMachine(groups, "all", 1000);
    assert.equal(unifiedLayout.nodes.length, 4);
    assert.equal(unifiedLayout.scenes?.length, 3);
  });

  it("resolves compound parent scene targets down to their initial leaf states without creating external dummy stubs", () => {
    const definition: StateMachineDefinition = {
      version: "1.1",
      id: "lesson",
      initial: "scene-1",
      states: {
        "scene-1": {
          initial: "presenting",
          states: {
            presenting: { on: { NEXT: "#lesson.scene-2" } },
          },
        },
        "scene-2": {
          initial: "presenting",
          states: {
            presenting: { on: { NEXT: "#lesson.scene-3" } },
          },
        },
        "scene-3": {
          initial: "round",
          states: {
            round: {
              initial: "ready",
              states: {
                ready: {},
              },
            },
          },
        },
      },
    };

    const groups = buildStateMachineGraph(definition);
    const layout = layoutAllScenesStateMachine(groups, 1000);

    // Transitions targeting parent scenes '#lesson.scene-2' and '#lesson.scene-3'
    // resolve directly to their initial leaf nodes:
    assert.equal(groups[0]!.nodes[0]!.transitions[0]!.targetId, "scene-2.presenting");
    assert.equal(groups[1]!.nodes[0]!.transitions[0]!.targetId, "scene-3.round.ready");

    // No external dummy stubs created at the bottom:
    assert.equal(layout.nodes.filter((n) => n.external).length, 0);
    assert.equal(layout.nodes.length, 4);
  });
  it("ranks a scene from its initial state and parks interruption states beside their anchor", () => {
    const groups = buildStateMachineGraph(bookDefinition);
    const layout = layoutStateMachineGroup(groups[1]!, 1000);
    const node = (id: string) =>
      layout.nodes.find((candidate) => candidate.id === id) as StateMachineLayoutNode;
    const narrating = node("page-2.narrating");
    const ready = node("page-2.ready");
    const wordAudio = node("page-2.word-audio");

    assert.ok(narrating.y < ready.y, "the initial state sits above the state it flows into");
    assert.equal(narrating.x, ready.x, "the spine is one column");
    assert.equal(wordAudio.detourOf, "page-2.ready");
    assert.equal(
      wordAudio.y,
      ready.y,
      "the detour sits level with its anchor instead of lengthening the spine",
    );
    assert.ok(wordAudio.x > ready.x + ready.width, "the detour sits in a side column");
    assert.deepEqual(
      layout.lanes.map((lane) => lane.label),
      ["State flow"],
      "non-success fallbacks stay in the flow lane",
    );

    const completed = layout.edges.find((edge) =>
      edge.id.startsWith("page-2.narrating:NARRATION.COMPLETED"),
    );
    assert.equal(completed?.kind, "forward");
    assert.equal(
      pathSegments(completed?.path ?? "").length,
      1,
      "an adjacent forward edge is one straight drop",
    );
    assert.deepEqual(arrowTip(completed as StateMachineLayoutEdge), {
      x: ready.x + ready.width / 2,
      y: ready.y,
    });

    const play = layout.edges.find((edge) =>
      edge.id.startsWith("page-2.ready:NARRATION.PLAY"),
    ) as StateMachineLayoutEdge;
    assert.equal(play.kind, "back");
    assert.equal(arrowTip(play).x, narrating.x, "back edges return into the target's left side");
    assert.ok(
      pathSegments(play.path).some(([x1, , x2]) => x1 === x2 && x1 < narrating.x),
      "back edges loop through the left channel",
    );

    const tapped = layout.edges.find((edge) =>
      edge.id.startsWith("page-2.ready:WORD.TAPPED"),
    ) as StateMachineLayoutEdge;
    const returned = layout.edges.find(
      (edge) => edge.id === "page-2.word-audio:WORD.AUDIO_COMPLETED:1:page-2.ready",
    ) as StateMachineLayoutEdge;
    assert.equal(tapped.kind, "detour");
    assert.equal(pathSegments(tapped.path).length, 1, "anchor to detour is a short horizontal");
    assert.equal(
      pathSegments(returned.path).length,
      1,
      "detour back to anchor is a short horizontal",
    );
    assert.equal(arrowTip(tapped).x, wordAudio.x);
    assert.equal(arrowTip(returned).x, ready.x + ready.width);
    assertCleanGeometry(layout);
  });

  it("routes edges that skip a row around the states in between", () => {
    const definition: StateMachineDefinition = {
      version: "1.1",
      id: "lesson",
      initial: "scene-1",
      states: {
        "scene-1": {
          initial: "intro",
          states: {
            intro: { on: { NEXT: "prompting", SKIP: "wrapping-up" } },
            prompting: { on: { NEXT: "answering" } },
            answering: { on: { NEXT: "wrapping-up", AGAIN: "prompting" } },
            "wrapping-up": { type: "final" },
          },
        },
      },
    };
    const group = buildStateMachineGraph(definition)[0]!;
    const layout = layoutStateMachineGroup(group, 900);
    const ys = ["intro", "prompting", "answering", "wrapping-up"].map(
      (name) => layout.nodes.find((node) => node.id === `scene-1.${name}`)?.y ?? 0,
    );
    assert.deepEqual(
      [...ys].sort((a, b) => a - b),
      ys,
      "states are ranked by longest path",
    );
    assert.equal(new Set(ys).size, 4);

    const skip = layout.edges.find((edge) =>
      edge.id.startsWith("scene-1.intro:SKIP"),
    ) as StateMachineLayoutEdge;
    const target = layout.nodes.find(
      (node) => node.id === "scene-1.wrapping-up",
    ) as StateMachineLayoutNode;
    assert.equal(skip.kind, "forward");
    assert.ok(
      pathSegments(skip.path).length > 1,
      "a skip is routed around, not drawn straight through",
    );
    assert.equal(arrowTip(skip).y, target.y, "forward skips still enter the target from the top");
    assert.equal(
      layout.edges.find((edge) => edge.id.startsWith("scene-1.answering:AGAIN"))?.kind,
      "back",
    );
    assertCleanGeometry(layout);
  });

  it("flows into the next scene and turns cross-scene back jumps into compact stubs", () => {
    const groups = buildStateMachineGraph(bookDefinition);
    const layout = layoutAllScenesStateMachine(groups, 1000);
    const next = layout.edges.find((edge) =>
      edge.id.startsWith("page-1.ready:PAGE.NEXT"),
    ) as StateMachineLayoutEdge;
    const nextTarget = layout.nodes.find(
      (node) => node.id === "page-2.narrating",
    ) as StateMachineLayoutNode;
    assert.equal(next.kind, "forward");
    assert.equal(pathSegments(next.path).length, 1, "Next drops straight into the next scene");
    assert.deepEqual(arrowTip(next), { x: nextTarget.x + nextTarget.width / 2, y: nextTarget.y });

    const previous = layout.edges.find((edge) =>
      edge.id.startsWith("page-3.ready:PAGE.PREVIOUS"),
    ) as StateMachineLayoutEdge;
    const source = layout.nodes.find(
      (node) => node.id === "page-3.ready",
    ) as StateMachineLayoutNode;
    assert.equal(previous.kind, "stub");
    assert.equal(previous.targetId, "page-2.ready");
    assert.equal(previous.label, "Previous → Page 2 · Ready");
    const xs = pathSegments(previous.path).flatMap(([x1, , x2]) => [x1, x2]);
    const ys = pathSegments(previous.path).flatMap(([, y1, , y2]) => [y1, y2]);
    assert.ok(
      Math.min(...ys) >= source.y && Math.max(...ys) <= source.y + source.height + 24,
      "the stub stays beside its source",
    );
    assert.ok(
      Math.max(...xs) <= source.x && source.x - Math.min(...xs) < 120,
      "the stub is short and on the left",
    );
    assert.ok(
      layout.edges
        .filter((edge) => edge.kind === "stub")
        .every((edge) => edge.id.includes("PAGE.PREVIOUS")),
    );
    assert.ok(
      layout.edges.some(
        (edge) =>
          edge.id.startsWith("page-3.ready:PAGE.NEXT") && edge.targetId === "activity.complete",
      ),
    );
    assertCleanGeometry(layout);
  });
  it("stacks sibling interruptions beside their shared anchor so the spine keeps flowing straight", () => {
    const tap = (sceneId: string) => ({
      guard: { type: "canTapWords", params: { sceneId } },
      target: "word-audio",
    });
    const decodablePage = (id: string, next: string): StateDefinition => ({
      initial: "delay",
      states: {
        delay: { on: { "READING_DELAY.ELAPSED": { target: "ready" }, "WORD.TAPPED": tap(id) } },
        narrating: { on: { "NARRATION.COMPLETED": { target: "ready" }, "WORD.TAPPED": tap(id) } },
        ready: {
          on: {
            "NARRATION.PLAY": { target: "narrating" },
            "PAGE.NEXT": { target: next },
            "WORD.TAPPED": tap(id),
          },
        },
        "word-audio": {
          on: {
            "WORD.AUDIO_COMPLETED": [
              {
                guard: {
                  type: "returnsToReaderState",
                  params: { sceneId: id, state: "narrating" },
                },
                target: "narrating",
              },
              {
                guard: { type: "returnsToReaderState", params: { sceneId: id, state: "delay" } },
                target: "delay",
              },
              { target: "ready" },
            ],
          },
        },
      },
    });
    const definition: StateMachineDefinition = {
      version: "1.1",
      id: "book",
      initial: "page-1",
      states: {
        "page-1": decodablePage("page-1", "#book.page-2"),
        "page-2": decodablePage("page-2", "#book.activity.complete"),
        activity: { initial: "complete", states: { complete: { type: "final" } } },
      },
    };
    const layout = layoutAllScenesStateMachine(buildStateMachineGraph(definition), 1200);
    const node = (id: string) =>
      layout.nodes.find((candidate) => candidate.id === id) as StateMachineLayoutNode;
    const ready = node("page-1.ready");
    const narrating = node("page-1.narrating");
    const wordAudio = node("page-1.word-audio");

    assert.equal(narrating.detourOf, "page-1.ready");
    assert.equal(wordAudio.detourOf, "page-1.ready");
    assert.equal(narrating.y, ready.y);
    assert.ok(
      wordAudio.y > narrating.y && wordAudio.x === narrating.x,
      "sibling detours stack in one side column",
    );
    assert.ok(node("page-1.delay").y < ready.y);

    const next = layout.edges.find((edge) =>
      edge.id.startsWith("page-1.ready:PAGE.NEXT"),
    ) as StateMachineLayoutEdge;
    assert.equal(pathSegments(next.path).length, 1, "Next drops straight into the next page");
    const sibling = layout.edges.find((edge) =>
      edge.id.startsWith("page-1.narrating:WORD.TAPPED"),
    ) as StateMachineLayoutEdge;
    assert.equal(
      pathSegments(sibling.path).length,
      1,
      "stacked siblings connect with a short vertical",
    );
    assertCleanGeometry(layout);
  });
});
