/**
 * The behavior map's data: one scene of the module's state machine, its phases and the
 * transitions between them, for the inspector, and the machine as the ported Loom layout
 * (state-machine-graph.ts) reads it.
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

import type {
  StateMachineDefinition,
  StateMachineImplementationReference,
  StateMachineStateNode,
  StateMachineTransition,
  StateMachineTransitions,
} from "./state-machine-graph";

type Json = Record<string, unknown>;
const object = (value: unknown): Json | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;

export interface StateMachine {
  /** The machine's own id, which a `#id.scene.phase` target names. */
  id: string;
  initial: string;
  states: Json;
}

/**
 * The module's machine, or null when its configuration carries none worth drawing. A generated
 * module keeps its configuration under its product code (`{ test21: { stateMachine } }`), so
 * a configuration without a machine of its own is looked into one level down.
 */
export function machineOf(configuration: unknown): StateMachine | null {
  const outer = object(configuration);
  const holds = (value: Json | null) =>
    !!(object(value?.stateMachine) ?? object(value?.activityMachine));
  const config = holds(outer)
    ? outer
    : (Object.values(outer ?? {})
        .map(object)
        .find(holds) ?? null);
  const machine = object(config?.stateMachine) ?? object(config?.activityMachine);
  const states = object(machine?.states);
  if (!machine || !states || typeof machine.initial !== "string") return null;
  return { id: typeof machine.id === "string" ? machine.id : "", initial: machine.initial, states };
}

/** An implementation reference Loom's model takes: a name, or `{ type, params }`. */
function implementation(value: unknown): StateMachineImplementationReference | null {
  if (typeof value === "string") return value;
  const type = object(value)?.type;
  return typeof type === "string" ? { type } : null;
}

function implementations(value: unknown): StateMachineImplementationReference[] | undefined {
  if (value === undefined) return undefined;
  const list = (Array.isArray(value) ? value : [value]).map(implementation);
  return list.filter((entry): entry is StateMachineImplementationReference => entry !== null);
}

function transitionsValue(value: unknown): StateMachineTransitions | undefined {
  const list = (Array.isArray(value) ? value : [value]).flatMap(
    (entry): StateMachineTransition[] => {
      if (typeof entry === "string") return [entry];
      const transition = object(entry);
      if (!transition) return [];
      const guard = implementation(transition.guard);
      return [
        {
          ...(typeof transition.target === "string" ? { target: transition.target } : {}),
          ...(guard ? { guard } : {}),
        },
      ];
    },
  );
  return list.length ? list : undefined;
}

function transitionMap(value: unknown): Record<string, StateMachineTransitions> | undefined {
  const source = object(value);
  if (!source) return undefined;
  const map: Record<string, StateMachineTransitions> = {};
  for (const [key, entry] of Object.entries(source)) {
    const transitions = transitionsValue(entry);
    if (transitions) map[key] = transitions;
  }
  return map;
}

function stateNode(value: Json): StateMachineStateNode {
  const node: StateMachineStateNode = {};
  if (typeof value.description === "string") node.description = value.description;
  if (value.type === "atomic" || value.type === "compound" || value.type === "final")
    node.type = value.type;
  if (typeof value.initial === "string") node.initial = value.initial;
  const states = object(value.states);
  if (states) node.states = stateNodes(states);
  const entry = implementations(value.entry);
  if (entry) node.entry = entry;
  const exit = implementations(value.exit);
  if (exit) node.exit = exit;
  const after = transitionMap(value.after);
  if (after) node.after = after;
  const on = transitionMap(value.on);
  if (on) node.on = on;
  const invoke = object(value.invoke);
  const src = implementation(invoke?.src);
  if (invoke && src) {
    node.invoke = { src: typeof src === "string" ? src : src.type };
    const onDone = transitionsValue(invoke.onDone);
    if (onDone) node.invoke.onDone = onDone;
    const onError = transitionsValue(invoke.onError);
    if (onError) node.invoke.onError = onError;
  }
  return node;
}

function stateNodes(states: Json): Record<string, StateMachineStateNode> {
  const nodes: Record<string, StateMachineStateNode> = {};
  for (const [id, value] of Object.entries(states)) {
    const state = object(value);
    if (state) nodes[id] = stateNode(state);
  }
  return nodes;
}

/**
 * The machine in the shape Loom's model types describe, for the ported layout. The JSON is the
 * module's own and unchecked, so only what has the expected shape is carried over: a transition
 * that is neither a name nor an object, or a state that is not an object, is left out.
 */
export function machineDefinition(machine: StateMachine): StateMachineDefinition {
  return { id: machine.id, initial: machine.initial, states: stateNodes(machine.states) };
}

/** The scenes the machine has, in its own order; `activity` is its frame, not a scene. */
export function machineScenes(machine: StateMachine): string[] {
  return Object.keys(machine.states).filter(
    (id) => id !== "activity" && object(object(machine.states[id])?.states) !== null,
  );
}

export interface MapNode {
  id: string;
  initial: boolean;
  final: boolean;
}

/** What fires a transition; the view words it. */
export type MapTrigger =
  | { kind: "event"; name: string }
  | { kind: "after"; ms: string }
  | { kind: "done" }
  | { kind: "error" };

export interface MapEdge {
  from: string;
  to: string;
  trigger: MapTrigger;
}

/** A transition that leaves the scene. */
export interface MapExit {
  from: string;
  to: string;
  trigger: MapTrigger;
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

/** Every transition a phase declares, with what fires it. */
function transitionsOf(phase: Json): { trigger: MapTrigger; target: string }[] {
  const found: { trigger: MapTrigger; target: string }[] = [];
  for (const [name, transition] of Object.entries(object(phase.on) ?? {}))
    for (const target of targets(transition))
      found.push({ trigger: { kind: "event", name }, target });
  for (const [ms, transition] of Object.entries(object(phase.after) ?? {}))
    for (const target of targets(transition))
      found.push({ trigger: { kind: "after", ms }, target });
  const invoke = object(phase.invoke);
  if (invoke) {
    for (const target of targets(invoke.onDone)) found.push({ trigger: { kind: "done" }, target });
    for (const target of targets(invoke.onError))
      found.push({ trigger: { kind: "error" }, target });
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
    for (const { trigger, target } of transitionsOf(object(children[id]) ?? {})) {
      const to = localPhase(target, sceneId, phases);
      if (to) edges.push({ from: id, to, trigger });
      else exits.push({ from: id, to: target, trigger });
    }

  const nodes = ids.map((id) => ({
    id,
    initial: id === initial,
    final: object(children[id])?.type === "final",
  }));
  return { nodes, edges, exits };
}

/** What one phase does, for the inspector beside the drawing. */
export interface PhaseDetails {
  id: string;
  initial: boolean;
  final: boolean;
  /** Actions named on entering and leaving the phase, in declared order. */
  entry: string[];
  exit: string[];
  /** Services the phase runs while it is active. */
  invokes: string[];
  /** Transitions out of the phase: to another phase here, or out of the scene. */
  outgoing: { trigger: MapTrigger; to: string; leaves: boolean }[];
  /** Phases of this scene that lead here. */
  incoming: { trigger: MapTrigger; from: string }[];
}

/** Action names from XState's shapes: a name, `{ type }`, or a list of either. */
function actionNames(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return list.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    const type = object(entry)?.type;
    return typeof type === "string" ? [type] : [];
  });
}

export function phaseDetails(
  machine: StateMachine,
  sceneId: string,
  phaseId: string,
): PhaseDetails | null {
  const map = sceneMap(machine, sceneId);
  const node = map?.nodes.find((entry) => entry.id === phaseId);
  const phase = object(object(object(machine.states[sceneId])?.states)?.[phaseId]);
  if (!map || !node || !phase) return null;
  const invoke = phase.invoke;
  const invokes = (Array.isArray(invoke) ? invoke : invoke === undefined ? [] : [invoke]).flatMap(
    (entry) => {
      const src = object(entry)?.src ?? entry;
      if (typeof src === "string") return [src];
      const type = object(src)?.type;
      return typeof type === "string" ? [type] : [];
    },
  );
  return {
    id: phaseId,
    initial: node.initial,
    final: node.final,
    entry: actionNames(phase.entry),
    exit: actionNames(phase.exit),
    invokes,
    outgoing: [
      ...map.edges
        .filter((edge) => edge.from === phaseId)
        .map((edge) => ({ trigger: edge.trigger, to: edge.to, leaves: false })),
      ...map.exits
        .filter((exit) => exit.from === phaseId)
        .map((exit) => ({ trigger: exit.trigger, to: exit.to.replace(/^#/, ""), leaves: true })),
    ],
    incoming: map.edges
      .filter((edge) => edge.to === phaseId)
      .map((edge) => ({ trigger: edge.trigger, from: edge.from })),
  };
}

/**
 * The drawing's zoom, as Loom's viewer has it in preview: a scale of the laid-out canvas
 * between a quarter and one and a half, in steps of fifteen points, and a fit that fills the
 * column's width without going past 120%.
 */
export const MAP_ZOOM = { min: 0.25, max: 1.5, step: 0.15, fitMax: 1.2 } as const;

const round = (value: number) => Math.round(value * 100) / 100;

/** The zoom after one step in a direction, holding at either end. */
export function stepZoom(current: number, direction: 1 | -1): number {
  return direction > 0
    ? Math.min(MAP_ZOOM.max, round(current + MAP_ZOOM.step))
    : Math.max(MAP_ZOOM.min, round(current - MAP_ZOOM.step));
}

/** The zoom that fits a canvas of `width` into `available` pixels; null when either is unknown. */
export function fitZoom(available: number, width: number): number | null {
  if (!(available > 0) || !(width > 0)) return null;
  return round(Math.min(MAP_ZOOM.fitMax, Math.max(MAP_ZOOM.min, available / width)));
}
