/**
 * The behavior map drawn under the player: one scene of the module's state machine, as
 * phases and the transitions between them, laid out top to bottom from the scene's first
 * phase.
 *
 * The machine is the module's own, read from its configuration (`stateMachine`, or
 * `activityMachine` in older modules), in the shape Loom's `waf-state-machine` defines:
 * one compound state per scene whose child states are the scene's phases, so a running
 * activity reports itself as `<scene>.<phase>`. A module without one has no map, and the
 * panel says so rather than drawing a guess.
 *
 * Everything here reads untrusted JSON, so it takes only strings it can check and never
 * assumes a shape.
 */

type Json = Record<string, unknown>;
const object = (value: unknown): Json | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;

export interface StateMachine {
  initial: string;
  states: Json;
}

/** The module's machine, or null when its configuration carries none worth drawing. */
export function machineOf(configuration: unknown): StateMachine | null {
  const config = object(configuration);
  const machine = object(config?.stateMachine) ?? object(config?.activityMachine);
  const states = object(machine?.states);
  if (!machine || !states || typeof machine.initial !== "string") return null;
  return { initial: machine.initial, states };
}

/** The scenes the machine has, in its own order; `activity` is its frame, not a scene. */
export function machineScenes(machine: StateMachine): string[] {
  return Object.keys(machine.states).filter(
    (id) => id !== "activity" && object(object(machine.states[id])?.states) !== null,
  );
}

export interface MapNode {
  id: string;
  /** Rows from the scene's first phase; unreachable phases sit on a row after the rest. */
  depth: number;
  /** Position within its row, and how many share the row. */
  column: number;
  columns: number;
  initial: boolean;
  final: boolean;
}

export interface MapEdge {
  from: string;
  to: string;
  /** The event, `after 3000 ms`, `done` or `error`. */
  label: string;
  /** Goes back up the map or stays on its row: drawn dashed, the way a retry reads. */
  back: boolean;
}

/** A transition that leaves the scene, for the list under the drawing. */
export interface MapExit {
  from: string;
  to: string;
  label: string;
}

export interface SceneMap {
  nodes: MapNode[];
  edges: MapEdge[];
  exits: MapExit[];
}

function targets(transition: unknown): string[] {
  const list = Array.isArray(transition) ? transition : [transition];
  return list.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    const target = object(entry)?.target;
    return typeof target === "string" ? [target] : [];
  });
}

/** Every transition a phase declares, with the name an author knows it by. */
function transitionsOf(phase: Json): { label: string; target: string }[] {
  const found: { label: string; target: string }[] = [];
  for (const [event, transition] of Object.entries(object(phase.on) ?? {}))
    for (const target of targets(transition)) found.push({ label: event, target });
  for (const [delay, transition] of Object.entries(object(phase.after) ?? {}))
    for (const target of targets(transition)) found.push({ label: `after ${delay} ms`, target });
  const invoke = object(phase.invoke);
  if (invoke) {
    for (const target of targets(invoke.onDone)) found.push({ label: "done", target });
    for (const target of targets(invoke.onError)) found.push({ label: "error", target });
  }
  return found;
}

/**
 * A target as a phase of this scene, or null when it leaves the scene. XState writes a
 * sibling by name, a state anywhere by `#id`, and a nested one with dots.
 */
function localPhase(target: string, sceneId: string, phases: ReadonlySet<string>): string | null {
  const bare = target.startsWith("#") ? target.slice(1) : target;
  if (phases.has(bare)) return bare;
  const parts = bare.split(".");
  const last = parts[parts.length - 1]!;
  if (parts.length > 1 && parts[parts.length - 2] === sceneId && phases.has(last)) return last;
  return null;
}

export function sceneMap(machine: StateMachine, sceneId: string): SceneMap | null {
  const scene = object(machine.states[sceneId]);
  const children = object(scene?.states);
  if (!scene || !children) return null;
  const ids = Object.keys(children);
  const phases = new Set(ids);
  const initial =
    typeof scene.initial === "string" && phases.has(scene.initial) ? scene.initial : ids[0];

  const edges: MapEdge[] = [];
  const exits: MapExit[] = [];
  for (const id of ids)
    for (const { label, target } of transitionsOf(object(children[id]) ?? {})) {
      const to = localPhase(target, sceneId, phases);
      if (to) edges.push({ from: id, to, label, back: false });
      else exits.push({ from: id, to: target, label });
    }

  // Rows by the shortest path from the first phase, so the map reads in the order a
  // learner meets the phases.
  const depth = new Map<string, number>();
  if (initial) {
    depth.set(initial, 0);
    const queue = [initial];
    while (queue.length) {
      const at = queue.shift()!;
      for (const edge of edges)
        if (edge.from === at && !depth.has(edge.to)) {
          depth.set(edge.to, depth.get(at)! + 1);
          queue.push(edge.to);
        }
    }
  }
  const unreachable = Math.max(-1, ...depth.values()) + 1;
  for (const id of ids) if (!depth.has(id)) depth.set(id, unreachable);
  for (const edge of edges) edge.back = depth.get(edge.to)! <= depth.get(edge.from)!;

  const rows = new Map<number, string[]>();
  for (const id of ids) rows.set(depth.get(id)!, [...(rows.get(depth.get(id)!) ?? []), id]);
  const nodes = ids.map((id) => {
    const row = rows.get(depth.get(id)!)!;
    return {
      id,
      depth: depth.get(id)!,
      column: row.indexOf(id),
      columns: row.length,
      initial: id === initial,
      final: object(children[id])?.type === "final",
    };
  });
  return { nodes, edges, exits };
}
