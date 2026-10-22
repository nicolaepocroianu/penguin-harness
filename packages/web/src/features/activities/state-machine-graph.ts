/**
 * The behavior map's layout, ported from waf-loom's state machine viewer
 * (`frontend/src/app/features/state-machine/state-machine-graph.ts`) so the map reads the way
 * Loom draws it: recovery, flow and happy-path lanes, rows ranked from the first state, detour
 * states stacked beside the state they return to, orthogonal edges routed through channels
 * and tracks so parallel lines never overlap, labelled edge pills, stub badges for jumps to a
 * distant scene, and external nodes (at most three a row) for targets outside the group.
 *
 * The algorithm is Loom's, kept framework-free and pure. Two things differ: the model types
 * below are the part of Loom's `state-machine.model.ts` the layout reads, and the fixed words
 * it writes (lane names, "else", the humanized guards) come from the strings file.
 */
import { S } from "../../lib/strings";

/** The fixed words the layout writes, from the strings file. */
const graphWords = () => S.activities.studioPlayer.map.layout;

export interface StateMachineImplementationDescriptor {
  type: string;
  params?: Record<string, unknown>;
}

export type StateMachineImplementationReference = string | StateMachineImplementationDescriptor;
export type StateMachineNamedImplementation =
  StateMachineImplementationReference | StateMachineImplementationReference[];

export interface StateMachineTransitionObject {
  actions?: StateMachineNamedImplementation;
  guard?: StateMachineImplementationReference;
  target?: string;
}

export type StateMachineTransition = string | StateMachineTransitionObject;
export type StateMachineTransitions = StateMachineTransition | StateMachineTransition[];

export interface StateMachineInvoke {
  id?: string;
  src: string;
  onDone?: StateMachineTransitions;
  onError?: StateMachineTransitions;
}

export interface StateMachineStateNode {
  description?: string;
  type?: "atomic" | "compound" | "final";
  initial?: string;
  states?: Record<string, StateMachineStateNode>;
  entry?: StateMachineNamedImplementation;
  exit?: StateMachineNamedImplementation;
  /** Watchdog transitions keyed by positive-integer millisecond delays. */
  after?: Record<string, StateMachineTransitions>;
  invoke?: StateMachineInvoke;
  on?: Record<string, StateMachineTransitions>;
}

export interface StateMachineDefinition {
  $schema?: string;
  version?: "1.0" | "1.1";
  description?: string;
  metadata?: Record<string, unknown>;
  context?: Record<string, unknown>;
  id: string;
  initial: string;
  states: Record<string, StateMachineStateNode>;
}

const NODE_WIDTH = 230;
const NODE_HEIGHT = 58;
const EXTERNAL_NODE_HEIGHT = 38;
/** Minimum vertical space between two rows of states. */
const NODE_GAP = 66;
/** Horizontal space between states that share a row inside one lane. */
const SLOT_GAP = 44;
const CANVAS_PADDING_X = 16;
const CANVAS_PADDING_TOP = 44;
const CANVAS_PADDING_BOTTOM = 110;
/** Minimum horizontal space between two lanes. */
const COLUMN_GAP = 52;
const SCENE_HEADER_HEIGHT = 42;
const SCENE_GAP = 72;
/** Vertical space between detour states stacked beside the same anchor (room for their labels). */
const DETOUR_STACK_GAP = 56;
const DETOUR_MIN_GAP = 72;
const DETOUR_MAX_GAP = 220;
/** Distance from a node border to the first routing track of a channel. */
const CHANNEL_CLEARANCE = 22;
const CHANNEL_OUTER = 10;
const TRACK_GAP = 12;
/** Distance from a row border to the first horizontal routing track of a gap. */
const GAP_CLEARANCE = 16;
const PORT_GAP_X = 20;
const PORT_GAP_Y = 12;
const PORT_INSET_X = 18;
const PORT_INSET_Y = 9;
const ARROW_LENGTH = 8;
const ARROW_HALF_WIDTH = 4.5;
const CORNER_RADIUS = 8;
const LABEL_HEIGHT = 16;
const LABEL_CHAR_WIDTH = 6.1;
const LABEL_PADDING_X = 7;
/** Space between a stub badge and the node it leaves from (beyond any back-edge tracks). */
const STUB_CLEARANCE = 26;
const MAX_EXTERNALS_PER_ROW = 3;
const LANE_LABEL_ZONE = 28;

export interface StateMachineGraphTransition {
  event: string;
  guard: string;
  target: string;
  targetId: string;
}

export interface StateMachineGraphNode {
  actions: string[];
  description: string;
  id: string;
  label: string;
  initial: boolean;
  final: boolean;
  service: string;
  transitions: StateMachineGraphTransition[];
}

export interface StateMachineGraphGroup {
  id: string;
  label: string;
  nodes: StateMachineGraphNode[];
}

export interface StateMachineLayoutNode extends StateMachineGraphNode {
  x: number;
  y: number;
  width: number;
  height: number;
  external: boolean;
  lane: StateMachineLayoutLaneId;
  /** Id of the state this detour (interruption) state returns to, when it sits in a side column. */
  detourOf?: string;
}

export type StateMachineLayoutLaneId = "retry" | "flow" | "outcome";

export interface StateMachineLayoutLane {
  id: StateMachineLayoutLaneId;
  label: string;
  width: number;
  x: number;
}

/**
 * How an edge is drawn:
 * - `forward`: downward flow (straight, jogged, or a skip routed through the right channel)
 * - `back`: a return to an earlier state, routed through the left channel into the target's side
 * - `lateral`: a sideways move between lanes or states that share a row
 * - `detour`: a connection to or from a side-column detour state
 * - `self`: a self transition
 * - `stub`: a cross-scene jump drawn as a short badge instead of a long line
 */
export type StateMachineLayoutEdgeKind =
  "forward" | "back" | "lateral" | "detour" | "self" | "stub";

export interface StateMachineLayoutEdge {
  id: string;
  sourceId: string;
  targetId: string;
  path: string;
  /** Closed arrowhead polygon whose tip sits on the target border (or on the stub badge). */
  arrowPath: string;
  label: string;
  /** Center of the label pill. */
  labelX: number;
  labelY: number;
  labelWidth: number;
  labelHeight: number;
  guarded: boolean;
  fallback: boolean;
  exception: boolean;
  kind: StateMachineLayoutEdgeKind;
}

export interface StateMachineLayoutScene {
  id: string;
  label: string;
  y: number;
  height: number;
  nodeCount: number;
  originX: number;
  contentWidth: number;
}

export interface StateMachineGraphLayout {
  width: number;
  height: number;
  lanes: StateMachineLayoutLane[];
  scenes?: StateMachineLayoutScene[];
  nodes: StateMachineLayoutNode[];
  edges: StateMachineLayoutEdge[];
}

export function buildStateMachineGraph(
  definition: StateMachineDefinition,
): StateMachineGraphGroup[] {
  const stateIds = collectStateIds(definition);
  return Object.entries(definition.states).map(([groupId, group]) => {
    const children = group.states;
    if (!children) {
      return {
        id: groupId,
        label: groupId,
        nodes: [buildNode(groupId, group, definition.initial === groupId, definition, stateIds)],
      };
    }
    const initialLeafId = resolveInitialLeafId(groupId, group, stateIds);
    return {
      id: groupId,
      label: groupId,
      nodes: collectGraphNodes(children, groupId, initialLeafId, definition, stateIds),
    };
  });
}

function collectGraphNodes(
  states: Readonly<Record<string, StateMachineStateNode>>,
  parentId: string,
  initialLeafId: string,
  definition: StateMachineDefinition,
  stateIds: Set<string>,
): StateMachineGraphNode[] {
  const nodes: StateMachineGraphNode[] = [];
  for (const [name, state] of Object.entries(states)) {
    const id = `${parentId}.${name}`;
    nodes.push(buildNode(id, state, id === initialLeafId, definition, stateIds));
    if (state.states) {
      nodes.push(...collectGraphNodes(state.states, id, initialLeafId, definition, stateIds));
    }
  }
  return nodes;
}

export function layoutStateMachineGroup(
  group: StateMachineGraphGroup,
  availableWidth = 0,
): StateMachineGraphLayout {
  const localIds = new Set(group.nodes.map((node) => node.id));
  const externalIds = unique(
    group.nodes
      .flatMap((node) => node.transitions.map((transition) => transition.targetId))
      .filter((targetId) => targetId && !localIds.has(targetId)),
  );
  const seeds: LayoutSeed[] = [
    ...group.nodes.map((node) => ({ ...node, external: false })),
    ...externalIds.map((id) => externalSeed(id)),
  ];
  return layoutBlocks(
    [{ id: group.id, label: group.label, header: false, seeds }],
    group.nodes,
    availableWidth,
    { stubs: false, skipCrossSceneExceptions: false },
  );
}

export function layoutAllScenesStateMachine(
  groups: StateMachineGraphGroup[],
  availableWidth = 0,
): StateMachineGraphLayout {
  if (groups.length === 0) {
    return {
      width: Math.max(CANVAS_PADDING_X * 2 + NODE_WIDTH, Math.floor(availableWidth)),
      height: 100,
      lanes: [
        { id: "flow", label: graphWords().lanes.flow, x: CANVAS_PADDING_X, width: NODE_WIDTH },
      ],
      scenes: [],
      nodes: [],
      edges: [],
    };
  }
  const allNodes = groups.flatMap((group) => group.nodes);
  const allLocalIds = new Set(allNodes.map((node) => node.id));
  const externalIds = unique(
    allNodes
      .flatMap((node) => node.transitions.map((transition) => transition.targetId))
      .filter((targetId) => targetId && !allLocalIds.has(targetId)),
  );
  const blocks: BlockInput[] = groups
    .filter((group) => group.nodes.length > 0)
    .map((group) => ({
      id: group.id,
      label: humanizeSceneLabel(group.label || group.id),
      header: true,
      seeds: group.nodes.map((node) => ({ ...node, external: false })),
    }));
  if (externalIds.length) {
    blocks.push({
      id: "__external__",
      label: "",
      header: false,
      seeds: externalIds.map((id) => externalSeed(id)),
    });
  }
  return layoutBlocks(blocks, allNodes, availableWidth, {
    stubs: true,
    // Distant cross-scene exception lines (e.g. EFFECT.FAILED -> activity.error) would clutter the canvas.
    skipCrossSceneExceptions: true,
  });
}

export function layoutStateMachine(
  groups: StateMachineGraphGroup[],
  selectedGroupId = "all",
  availableWidth = 0,
): StateMachineGraphLayout {
  if (selectedGroupId === "all" || !selectedGroupId) {
    return layoutAllScenesStateMachine(groups, availableWidth);
  }
  const group = groups.find((g) => g.id === selectedGroupId);
  if (!group) {
    return layoutAllScenesStateMachine(groups, availableWidth);
  }
  return layoutStateMachineGroup(group, availableWidth);
}

/* ------------------------------------------------------------------------------------------------
 * Layout engine
 *
 * 1. Lanes: states are split into recovery / flow / happy-path lanes (unchanged heuristics).
 * 2. Detours: an interruption state whose every exit returns to a state that also enters it
 *    (e.g. `word-audio`) is moved into a side column beside its anchor (its fallback return target).
 * 3. Ranks: per block (scene), the remaining states are ranked from the initial state by longest
 *    path over forward edges; edges to a DFS ancestor are back edges and do not add rank.
 *    Rows are stacked block after block; same-rank states sit side by side in their lane.
 * 4. Routing: orthogonal paths with rounded corners. Adjacent-row forward edges drop straight from
 *    bottom-center to top-center (with a jog in the gap when columns differ). Skips use the lane's
 *    right channel and enter the target from the top; back edges use the left channel and enter
 *    the target's left side. Every channel / gap segment gets its own track, so parallel edges
 *    never overlap. Cross-scene jumps that are not "next scene" become compact stub badges.
 * 5. Labels are pills on a straight segment, nudged away from nodes, arrowheads and other labels.
 * ---------------------------------------------------------------------------------------------- */

type Side = "top" | "bottom" | "left" | "right";
type LayoutSeed = StateMachineGraphNode & { external: boolean };

interface Point {
  x: number;
  y: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BlockInput {
  id: string;
  label: string;
  header: boolean;
  seeds: LayoutSeed[];
}

interface LayoutOptions {
  stubs: boolean;
  skipCrossSceneExceptions: boolean;
}

interface EngineNode {
  seed: LayoutSeed;
  order: number;
  block: number;
  laneIndex: number;
  lane: StateMachineLayoutLaneId;
  rank: number;
  row: number;
  slot: number;
  slotCount: number;
  anchor: EngineNode | null;
  detours: EngineNode[];
  stackIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface EngineBlock {
  index: number;
  id: string;
  label: string;
  header: boolean;
  nodes: EngineNode[];
  firstRow: number;
  rowCount: number;
}

interface EngineLane {
  id: StateMachineLayoutLaneId;
  label: string;
  cols: number;
  hasDetour: boolean;
  leftTracks: number;
  rightTracks: number;
  stubWidth: number;
  detourGap: number;
  /** Space between same-row states of this lane (widened to fit lateral labels). */
  slotGap: number;
  /** Minimum space to the next lane (widened to fit labels of lateral edges between them). */
  lateralGap: number;
  mainX: number;
  mainWidth: number;
  detourX: number;
  end: number;
}

interface ChannelRef {
  lane: number;
  side: "left" | "right";
}

type EdgePlan =
  | { type: "self" }
  | { type: "stub"; text: string }
  | { type: "direct" }
  | { type: "stack" }
  | { type: "jog" }
  | { type: "under" }
  | {
      type: "channel";
      channel: ChannelRef;
      exit: Side;
      exitGap: number | null;
      entry: Side;
      entryGap: number | null;
    };

interface PortRequest {
  edge: EngineEdge;
  node: EngineNode;
  side: Side;
  key: number;
  pinned: boolean;
  offset: number;
}

interface GapRequest {
  gap: number;
  from: number;
  to: number;
  track: number;
  y: number;
}

interface EngineEdge {
  id: string;
  index: number;
  source: EngineNode;
  target: EngineNode;
  transition: StateMachineGraphTransition;
  label: string;
  guarded: boolean;
  fallback: boolean;
  exception: boolean;
  kind: StateMachineLayoutEdgeKind;
  plan: EdgePlan;
  startPort: PortRequest | null;
  endPort: PortRequest | null;
  track: number;
  levels: [number, number];
  startGap: GapRequest | null;
  endGap: GapRequest | null;
  midGap: GapRequest | null;
  points: Point[];
  arrow: Point[];
  labelBox: Box | null;
}

function externalSeed(id: string): LayoutSeed {
  return {
    id,
    label: id,
    actions: [],
    description: "",
    initial: false,
    final: false,
    service: "",
    transitions: [],
    external: true,
  };
}

function layoutBlocks(
  blockInputs: BlockInput[],
  laneSourceNodes: StateMachineGraphNode[],
  availableWidth: number,
  options: LayoutOptions,
): StateMachineGraphLayout {
  /* -- lanes ----------------------------------------------------------------------------------- */
  const allSeeds = blockInputs.flatMap((block) => block.seeds);
  const seedById = new Map(allSeeds.map((seed) => [seed.id, seed]));
  const outcomeIds = collectOutcomeLaneIds(laneSourceNodes, seedById);
  const retryIds = collectRecoveryLaneIds(laneSourceNodes, seedById, outcomeIds);
  const laneOf = (id: string): StateMachineLayoutLaneId =>
    outcomeIds.has(id) ? "outcome" : retryIds.has(id) ? "retry" : "flow";
  const usedLanes = new Set(allSeeds.map((seed) => laneOf(seed.id)));
  const laneIds = (["retry", "flow", "outcome"] as const).filter(
    (lane) => lane === "flow" || usedLanes.has(lane),
  );
  const lanes: EngineLane[] = laneIds.map((id) => ({
    id,
    label: graphWords().lanes[id],
    cols: 1,
    hasDetour: false,
    leftTracks: 0,
    rightTracks: 0,
    stubWidth: 0,
    detourGap: DETOUR_MIN_GAP,
    slotGap: SLOT_GAP,
    lateralGap: 0,
    mainX: 0,
    mainWidth: NODE_WIDTH,
    detourX: 0,
    end: 0,
  }));

  /* -- nodes and edges ------------------------------------------------------------------------- */
  const blocks: EngineBlock[] = [];
  const nodes: EngineNode[] = [];
  for (const input of blockInputs) {
    const block: EngineBlock = {
      index: blocks.length,
      id: input.id,
      label: input.label,
      header: input.header,
      nodes: [],
      firstRow: 0,
      rowCount: 0,
    };
    for (const seed of input.seeds) {
      const lane = laneOf(seed.id);
      const node: EngineNode = {
        seed,
        order: nodes.length,
        block: block.index,
        laneIndex: laneIds.indexOf(lane),
        lane,
        rank: 0,
        row: 0,
        slot: 0,
        slotCount: 1,
        anchor: null,
        detours: [],
        stackIndex: 0,
        x: 0,
        y: 0,
        width: NODE_WIDTH,
        height: seed.external ? EXTERNAL_NODE_HEIGHT : NODE_HEIGHT,
      };
      block.nodes.push(node);
      nodes.push(node);
    }
    blocks.push(block);
  }
  const nodeById = new Map(nodes.map((node) => [node.seed.id, node]));
  const edges = collectEdges(nodes, nodeById, options);

  /* -- detours, ranks and rows ----------------------------------------------------------------- */
  let rowCursor = 0;
  for (const block of blocks) {
    const locals = block.nodes.filter((node) => !node.seed.external);
    const blockEdges = edges.filter((edge) => edge.source.block === block.index);
    detectDetours(locals, blockEdges);
    const rankCount = rankSpine(locals, blockEdges);
    let externalRows = 0;
    for (const [laneIndex] of lanes.entries()) {
      const laneExternals = block.nodes.filter(
        (node) => node.seed.external && node.laneIndex === laneIndex,
      );
      laneExternals.forEach((node, index) => {
        node.rank = rankCount + Math.floor(index / MAX_EXTERNALS_PER_ROW);
      });
      externalRows = Math.max(
        externalRows,
        Math.ceil(laneExternals.length / MAX_EXTERNALS_PER_ROW),
      );
    }
    block.firstRow = rowCursor;
    block.rowCount = Math.max(1, rankCount + externalRows);
    for (const node of block.nodes) node.row = block.firstRow + node.rank;
    rowCursor += block.rowCount;
  }
  const rowCount = rowCursor;
  assignSlots(nodes, edges, lanes, rowCount);

  /* -- provisional geometry (used for routing decisions only) ---------------------------------- */
  const rowNodes: EngineNode[][] = Array.from({ length: rowCount }, () => []);
  for (const node of nodes) rowNodes[node.row]!.push(node);
  const gapKinds = buildGapKinds(blocks, rowCount);
  computeX(nodes, lanes);
  computeY(nodes, rowNodes, gapKinds, new Map());

  /* -- route plans ----------------------------------------------------------------------------- */
  const router = new RoutePlanner(lanes, rowNodes, options, blocks);
  for (const edge of edges) {
    edge.plan = router.plan(edge);
    edge.kind = edgeKind(edge);
  }

  /* -- vertical channel tracks ----------------------------------------------------------------- */
  assignChannelTracks(edges, lanes);

  /* -- stub badges and detour label room ------------------------------------------------------- */
  for (const edge of edges) {
    if (edge.plan.type === "stub") {
      const lane = lanes[edge.source.laneIndex]!;
      lane.stubWidth = Math.max(lane.stubWidth, labelWidthFor(edge.plan.text));
    }
    if (edge.plan.type === "direct" && edge.label) {
      const room = labelWidthFor(edge.label) + 12;
      const { source, target } = edge;
      if (edge.kind === "detour") {
        const lane = lanes[source.laneIndex]!;
        lane.detourGap = Math.max(lane.detourGap, room + 16);
      } else if (source.laneIndex === target.laneIndex) {
        const lane = lanes[source.laneIndex]!;
        lane.slotGap = Math.max(lane.slotGap, room);
      } else if (Math.abs(source.laneIndex - target.laneIndex) === 1) {
        const lane = lanes[Math.min(source.laneIndex, target.laneIndex)]!;
        lane.lateralGap = Math.max(lane.lateralGap, room);
      }
    }
  }
  for (const lane of lanes) lane.detourGap = Math.min(DETOUR_MAX_GAP, lane.detourGap);

  /* -- final horizontal geometry and ports ----------------------------------------------------- */
  computeX(nodes, lanes);
  assignPorts(edges, lanes);

  /* -- horizontal gap tracks, final vertical geometry ------------------------------------------ */
  const gapTrackCounts = assignGapTracks(edges, lanes);
  const rowGeometry = computeY(nodes, rowNodes, gapKinds, gapTrackCounts);
  for (const edge of edges) {
    for (const request of [edge.startGap, edge.endGap, edge.midGap]) {
      if (request)
        request.y = rowGeometry.trackY(
          request.gap,
          request.track,
          gapTrackCounts.get(request.gap) ?? 1,
        );
    }
  }

  /* -- paths ----------------------------------------------------------------------------------- */
  const stubBoxes = buildEdgePoints(edges, lanes);
  const headerBoxes = blocks
    .filter((block) => block.header)
    .map((block) => sceneHeaderBox(block, lanes, rowGeometry.rowTop));
  placeLabels(edges, nodes, [...headerBoxes, ...stubBoxes]);

  /* -- normalize horizontally and emit --------------------------------------------------------- */
  const xs: number[] = [];
  for (const node of nodes) xs.push(node.x, node.x + node.width);
  for (const lane of lanes) xs.push(lane.mainX, lane.end);
  for (const edge of edges) {
    for (const point of [...edge.points, ...edge.arrow]) xs.push(point.x);
    if (edge.labelBox) xs.push(edge.labelBox.x, edge.labelBox.x + edge.labelBox.width);
  }
  for (const box of headerBoxes) xs.push(box.x, box.x + box.width);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const contentWidth = maxX - minX;
  const width = Math.max(
    Math.floor(availableWidth),
    Math.ceil(contentWidth + CANVAS_PADDING_X * 2),
  );
  const shift = Math.round((width - contentWidth) / 2 - minX);

  const outputNodes: StateMachineLayoutNode[] = nodes.map((node) => ({
    ...node.seed,
    x: node.x + shift,
    y: node.y,
    width: node.width,
    height: node.height,
    external: node.seed.external,
    lane: node.lane,
    ...(node.anchor ? { detourOf: node.anchor.seed.id } : {}),
  }));
  const outputEdges: StateMachineLayoutEdge[] = edges.map((edge) => emitEdge(edge, shift));
  const outputLanes: StateMachineLayoutLane[] = lanes.map((lane) => ({
    id: lane.id,
    label: lane.label,
    x: lane.mainX + shift,
    width: lane.end - lane.mainX,
  }));
  const scenes: StateMachineLayoutScene[] = blocks
    .filter((block) => block.header)
    .map((block) => {
      const lane = lanes[sceneLaneIndex(block)]!;
      const top = rowGeometry.rowTop[block.firstRow]! - SCENE_HEADER_HEIGHT;
      const bottom = Math.max(...block.nodes.map((node) => node.y + node.height));
      return {
        id: block.id,
        label: block.label,
        y: top,
        height: bottom - top,
        nodeCount: block.nodes.length,
        originX: lane.mainX + shift,
        contentWidth: lane.mainWidth,
      };
    });
  const labelBottom = Math.max(
    0,
    ...edges.map((edge) => (edge.labelBox ? edge.labelBox.y + edge.labelBox.height : 0)),
  );
  const layout: StateMachineGraphLayout = {
    width,
    height: Math.ceil(Math.max(rowGeometry.height, labelBottom + 24)),
    lanes: outputLanes,
    nodes: outputNodes,
    edges: outputEdges,
  };
  if (options.stubs) layout.scenes = scenes;
  return layout;
}

function collectEdges(
  nodes: EngineNode[],
  nodeById: Map<string, EngineNode>,
  options: LayoutOptions,
): EngineEdge[] {
  const edges: EngineEdge[] = [];
  for (const source of nodes) {
    if (source.seed.external) continue;
    const eventCounts = countBy(source.seed.transitions, (transition) => transition.event);
    for (const [index, transition] of source.seed.transitions.entries()) {
      const target = nodeById.get(transition.targetId);
      if (!target) continue;
      const exception = isRecoveryException(transition);
      if (
        options.skipCrossSceneExceptions &&
        exception &&
        sceneKey(source.seed.id) !== sceneKey(target.seed.id)
      ) {
        continue;
      }
      const hasSiblings = (eventCounts.get(transition.event) ?? 0) > 1;
      const fallback = isFallbackTransition(transition, hasSiblings);
      edges.push({
        id: `${source.seed.id}:${transition.event}:${index}:${transition.targetId}`,
        index: edges.length,
        source,
        target,
        transition,
        label: exception ? "" : transitionLabel(transition, fallback),
        guarded: Boolean(transition.guard),
        fallback,
        exception,
        kind: "forward",
        plan: { type: "jog" },
        startPort: null,
        endPort: null,
        track: 0,
        levels: [0, 0],
        startGap: null,
        endGap: null,
        midGap: null,
        points: [],
        arrow: [],
        labelBox: null,
      });
    }
  }
  return edges;
}

/**
 * Detours are interruption states: every exit returns to a state that also enters them, and they
 * are either entered by a single event or return to exactly the states they came from. They are
 * laid out beside an anchor (their fallback return target) instead of lengthening the main spine.
 */
function detectDetours(locals: EngineNode[], edges: EngineEdge[]): void {
  const localSet = new Set(locals);
  const successors = new Map<EngineNode, EngineNode[]>();
  const predecessors = new Map<EngineNode, Set<EngineNode>>();
  const enteringEvents = new Map<EngineNode, Set<string>>();
  const leavesBlock = new Set<EngineNode>();
  for (const edge of edges) {
    if (!localSet.has(edge.source)) continue;
    if (!localSet.has(edge.target)) {
      leavesBlock.add(edge.source);
      continue;
    }
    if (edge.source === edge.target) continue;
    pushTo(successors, edge.source, edge.target);
    addTo(predecessors, edge.target, edge.source);
    addTo(enteringEvents, edge.target, edge.transition.event);
  }
  const initial = locals.find((node) => node.seed.initial) ?? locals[0];
  if (!initial) return;
  const reachable = (excluded: Set<EngineNode>): Set<EngineNode> => {
    const seen = new Set<EngineNode>([initial]);
    const queue = [initial];
    while (queue.length) {
      const node = queue.shift() as EngineNode;
      for (const next of successors.get(node) ?? []) {
        if (excluded.has(next) || seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    return seen;
  };
  const detours = new Set<EngineNode>();
  const anchors = new Set<EngineNode>();
  let baseline = reachable(detours);
  for (const candidate of [...locals].reverse()) {
    if (candidate === initial || candidate.seed.final || leavesBlock.has(candidate)) continue;
    if (anchors.has(candidate)) continue;
    const targets = unique(successors.get(candidate) ?? []);
    const sources = predecessors.get(candidate) ?? new Set<EngineNode>();
    if (!targets.length || !targets.every((target) => sources.has(target))) continue;
    const returnsToEveryEntry = [...sources].every((source) => targets.includes(source));
    if (!returnsToEveryEntry && (enteringEvents.get(candidate)?.size ?? 0) !== 1) continue;
    const anchor = detourAnchor(candidate, targets);
    if (!anchor || anchor.laneIndex !== candidate.laneIndex || detours.has(anchor)) continue;
    // A detour may hand over to a sibling detour of the same anchor, but never to another anchor's.
    if (targets.some((target) => detours.has(target) && target.anchor !== anchor)) continue;
    const trial = new Set([...detours, candidate]);
    const reach = reachable(trial);
    if ([...baseline].some((node) => node !== candidate && !reach.has(node))) continue;
    detours.add(candidate);
    anchors.add(anchor);
    candidate.anchor = anchor;
    baseline = reach;
  }
  for (const node of locals) {
    if (node.anchor) node.anchor.detours.push(node);
  }
  for (const node of locals) {
    node.detours.sort((a, b) => a.order - b.order);
    node.detours.forEach((detour, index) => {
      detour.stackIndex = index;
    });
  }
}

/** The fallback (unguarded) return target, or the last listed return target. */
function detourAnchor(detour: EngineNode, targets: EngineNode[]): EngineNode | null {
  const targetIds = new Set(targets.map((target) => target.seed.id));
  const returns = detour.seed.transitions.filter((transition) =>
    targetIds.has(transition.targetId),
  );
  const fallback = [...returns].reverse().find((transition) => !transition.guard) ?? returns.at(-1);
  return targets.find((target) => target.seed.id === fallback?.targetId) ?? null;
}

/** Longest-path ranking over forward edges from the initial state. Returns the number of ranks. */
function rankSpine(locals: EngineNode[], edges: EngineEdge[]): number {
  const spine = locals.filter((node) => !node.anchor);
  const spineSet = new Set(spine);
  const successors = new Map<EngineNode, EngineNode[]>();
  for (const edge of edges) {
    if (edge.source === edge.target || !spineSet.has(edge.source) || !spineSet.has(edge.target))
      continue;
    pushTo(successors, edge.source, edge.target);
  }
  const initial = spine.find((node) => node.seed.initial) ?? spine[0];
  if (!initial) return 0;
  const visited = new Set<EngineNode>();
  const onStack = new Set<EngineNode>();
  const backEdges = new Set<string>();
  const postOrder: EngineNode[] = [];
  const visit = (node: EngineNode): void => {
    visited.add(node);
    onStack.add(node);
    for (const next of successors.get(node) ?? []) {
      if (onStack.has(next)) backEdges.add(`${node.order}>${next.order}`);
      else if (!visited.has(next)) visit(next);
    }
    onStack.delete(node);
    postOrder.push(node);
  };
  for (const node of [initial, ...spine]) {
    if (!visited.has(node)) visit(node);
  }
  const forwardPredecessors = new Map<EngineNode, EngineNode[]>();
  for (const [node, nexts] of successors) {
    for (const next of nexts) {
      if (!backEdges.has(`${node.order}>${next.order}`)) pushTo(forwardPredecessors, next, node);
    }
  }
  for (const node of postOrder.reverse()) {
    const predecessors = forwardPredecessors.get(node) ?? [];
    // The happy path starts beside the earliest step that can succeed; every other forward
    // edge (including recovery branches) moves at least one row down.
    const successEntries = predecessors.filter(
      (source) => node.lane === "outcome" && source.lane !== "outcome",
    );
    const steps = predecessors.filter((source) => !successEntries.includes(source));
    node.rank = Math.max(
      0,
      ...steps.map((source) => source.rank + 1),
      ...(successEntries.length ? [Math.min(...successEntries.map((source) => source.rank))] : []),
    );
  }
  for (const node of locals) {
    if (node.anchor) node.rank = node.anchor.rank;
  }
  return spine.length ? Math.max(...spine.map((node) => node.rank)) + 1 : 0;
}

/** Orders same-row states in each lane by the barycenter of their predecessors (one top-down pass). */
function assignSlots(
  nodes: EngineNode[],
  edges: EngineEdge[],
  lanes: EngineLane[],
  rowCount: number,
): void {
  const predecessors = new Map<EngineNode, EngineNode[]>();
  for (const edge of edges) {
    if (edge.source !== edge.target && edge.source.row < edge.target.row) {
      pushTo(predecessors, edge.target, edge.source);
    }
  }
  const position = new Map<EngineNode, number>();
  for (let row = 0; row < rowCount; row += 1) {
    for (const [laneIndex, lane] of lanes.entries()) {
      const group = nodes.filter(
        (node) => node.row === row && node.laneIndex === laneIndex && !node.anchor,
      );
      const barycenter = new Map(
        group.map((node) => {
          const placed = (predecessors.get(node) ?? []).filter((source) => position.has(source));
          const value = placed.length
            ? placed.reduce((total, source) => total + (position.get(source) ?? 0), 0) /
              placed.length
            : laneIndex * 1000;
          return [node, value] as const;
        }),
      );
      group.sort(
        (a, b) =>
          Number(a.detours.length > 0) - Number(b.detours.length > 0) ||
          (barycenter.get(a) ?? 0) - (barycenter.get(b) ?? 0) ||
          a.order - b.order,
      );
      group.forEach((node, slot) => {
        node.slot = slot;
        node.slotCount = group.length;
        position.set(node, laneIndex * 1000 + (slot - (group.length - 1) / 2) * 10);
      });
      lane.cols = Math.max(lane.cols, group.length);
    }
    for (const node of nodes) {
      if (node.row === row && node.anchor) {
        position.set(node, node.laneIndex * 1000 + 500);
        node.slot = -1;
        lanes[node.laneIndex]!.hasDetour = true;
      }
    }
  }
}

type GapKind = "top" | "topHeader" | "header" | "boundary" | "inner" | "bottom";

function buildGapKinds(blocks: EngineBlock[], rowCount: number): GapKind[] {
  const kinds: GapKind[] = Array.from({ length: rowCount + 1 }, () => "inner" as GapKind);
  for (const block of blocks) {
    if (block.firstRow > 0) kinds[block.firstRow] = block.header ? "header" : "boundary";
  }
  kinds[0] = blocks[0]?.header ? "topHeader" : "top";
  kinds[rowCount] = "bottom";
  return kinds;
}

function channelWidth(tracks: number): number {
  return tracks ? CHANNEL_CLEARANCE + (tracks - 1) * TRACK_GAP + CHANNEL_OUTER : 0;
}

function leftReserve(lane: EngineLane): number {
  const tracks = channelWidth(lane.leftTracks);
  return lane.stubWidth ? Math.max(tracks, 0) + STUB_CLEARANCE + lane.stubWidth : tracks;
}

function computeX(nodes: EngineNode[], lanes: EngineLane[]): void {
  let cursor = 0;
  lanes.forEach((lane, index) => {
    if (index === 0) {
      cursor += leftReserve(lane);
    } else {
      const previous = lanes[index - 1]!;
      const trailing = previous.hasDetour ? 0 : channelWidth(previous.rightTracks);
      cursor += Math.max(COLUMN_GAP, trailing + leftReserve(lane) + 12, previous.lateralGap);
    }
    lane.mainX = cursor;
    lane.mainWidth = lane.cols * NODE_WIDTH + (lane.cols - 1) * lane.slotGap;
    const mainRight = lane.mainX + lane.mainWidth;
    if (lane.hasDetour) {
      lane.detourX = mainRight + channelWidth(lane.rightTracks) + lane.detourGap;
      lane.end = lane.detourX + NODE_WIDTH;
    } else {
      lane.detourX = mainRight;
      lane.end = mainRight;
    }
    cursor = lane.end;
  });
  for (const node of nodes) {
    const lane = lanes[node.laneIndex]!;
    if (node.anchor) {
      node.x = lane.detourX;
      continue;
    }
    const rowWidth = node.slotCount * NODE_WIDTH + (node.slotCount - 1) * lane.slotGap;
    node.x = lane.mainX + (lane.mainWidth - rowWidth) / 2 + node.slot * (NODE_WIDTH + lane.slotGap);
  }
}

interface RowGeometry {
  rowTop: number[];
  height: number;
  trackY(gap: number, track: number, count: number): number;
}

function computeY(
  nodes: EngineNode[],
  rowNodes: EngineNode[][],
  gapKinds: GapKind[],
  gapTracks: Map<number, number>,
): RowGeometry {
  const rowCount = rowNodes.length;
  const rowHeight = rowNodes.map((members) =>
    Math.max(
      EXTERNAL_NODE_HEIGHT,
      ...members.map((node) =>
        node.anchor
          ? node.stackIndex * (NODE_HEIGHT + DETOUR_STACK_GAP) + node.height
          : node.height,
      ),
    ),
  );
  const rowTop: number[] = [];
  const zones: Array<[number, number]> = [];
  let cursor = 0;
  for (let gap = 0; gap <= rowCount; gap += 1) {
    const tracks = gapTracks.get(gap) ?? 0;
    const zoneNeed = tracks ? GAP_CLEARANCE * 2 + (tracks - 1) * TRACK_GAP : 0;
    const kind = gapKinds[gap];
    const header = kind === "header" || kind === "topHeader" ? SCENE_HEADER_HEIGHT : 0;
    let height: number;
    let zone: [number, number];
    if (kind === "top" || kind === "topHeader") {
      const above = Math.max(CANVAS_PADDING_TOP - LANE_LABEL_ZONE, zoneNeed);
      height = LANE_LABEL_ZONE + above + header;
      zone = [cursor + LANE_LABEL_ZONE, cursor + LANE_LABEL_ZONE + above];
    } else if (kind === "bottom") {
      height = Math.max(CANVAS_PADDING_BOTTOM, zoneNeed + 40);
      zone = [cursor, cursor + Math.max(zoneNeed, NODE_GAP)];
    } else {
      const base = kind === "inner" ? NODE_GAP : SCENE_GAP;
      const free = Math.max(base, zoneNeed);
      height = free + header;
      zone = [cursor, cursor + free];
    }
    zones.push(zone);
    cursor += height;
    if (gap < rowCount) {
      rowTop.push(cursor);
      cursor += rowHeight[gap]!;
    }
  }
  for (const node of nodes) {
    node.y =
      rowTop[node.row]! + (node.anchor ? node.stackIndex * (NODE_HEIGHT + DETOUR_STACK_GAP) : 0);
  }
  return {
    rowTop,
    height: cursor,
    trackY: (gap, track, count) => {
      const [top, bottom] = zones[gap] ?? [0, 0];
      return (top + bottom) / 2 + (track - (count - 1) / 2) * TRACK_GAP;
    },
  };
}

function centerX(node: EngineNode): number {
  return node.x + node.width / 2;
}

function centerY(node: EngineNode): number {
  return node.y + node.height / 2;
}

function sideX(node: EngineNode, side: Side): number {
  return side === "left" ? node.x : node.x + node.width;
}

function isTopOfStack(node: EngineNode): boolean {
  return !node.anchor || node.stackIndex === 0;
}

function isBottomOfStack(node: EngineNode): boolean {
  return !node.anchor || node.stackIndex === node.anchor.detours.length - 1;
}

function channelX(lanes: EngineLane[], channel: ChannelRef, track: number): number {
  const lane = lanes[channel.lane]!;
  return channel.side === "left"
    ? lane.mainX - CHANNEL_CLEARANCE - track * TRACK_GAP
    : lane.mainX + lane.mainWidth + CHANNEL_CLEARANCE + track * TRACK_GAP;
}

class RoutePlanner {
  constructor(
    private readonly lanes: EngineLane[],
    private readonly rowNodes: EngineNode[][],
    private readonly options: LayoutOptions,
    private readonly blocks: EngineBlock[],
  ) {}

  plan(edge: EngineEdge): EdgePlan {
    const source = edge.source;
    const target = edge.target;
    if (source === target) return { type: "self" };
    if (this.isStub(source, target)) return { type: "stub", text: this.stubText(edge) };
    if (source.anchor && source.anchor === target.anchor) return { type: "stack" };
    if (target.anchor === source || source.anchor === target || source.row === target.row) {
      const exitSide: Side = centerX(target) > centerX(source) ? "right" : "left";
      const entrySide: Side = exitSide === "right" ? "left" : "right";
      const sameRow = source.row === target.row;
      if (
        sameRow &&
        !this.blocked(
          source.row,
          centerY(source),
          sideX(source, exitSide),
          sideX(target, entrySide),
          [source, target],
        )
      ) {
        return { type: "direct" };
      }
      if (source.laneIndex === target.laneIndex && !source.anchor && !target.anchor && sameRow) {
        return { type: "under" };
      }
      const channel: ChannelRef =
        source.laneIndex === target.laneIndex
          ? { lane: source.laneIndex, side: "right" }
          : this.facingChannel(source, target);
      return this.channel(edge, channel, "side");
    }
    if (target.row === source.row + 1 && isBottomOfStack(source) && isTopOfStack(target)) {
      return { type: "jog" };
    }
    if (source.laneIndex === target.laneIndex) {
      if (source.anchor || target.anchor)
        return this.channel(edge, { lane: source.laneIndex, side: "right" }, "side");
      if (target.row > source.row)
        return this.channel(edge, { lane: source.laneIndex, side: "right" }, "top");
      return this.channel(edge, { lane: source.laneIndex, side: "left" }, "side");
    }
    const crossBlockForward = source.block !== target.block && target.row > source.row;
    return this.channel(
      edge,
      this.facingChannel(source, target),
      crossBlockForward ? "top" : "side",
    );
  }

  private isStub(source: EngineNode, target: EngineNode): boolean {
    if (!this.options.stubs || source.block === target.block || target.seed.external) return false;
    if (!this.blocks[source.block]?.header || !this.blocks[target.block]?.header) return false;
    return target.block < source.block || target.block > source.block + 1;
  }

  private stubText(edge: EngineEdge): string {
    const block = this.blocks[edge.target.block]!;
    const event = humanizeEventLabel(edge.transition.event) || edge.label;
    const state = edge.target.seed.initial ? "" : edge.target.seed.label;
    return graphWords().stub(event, block?.label ?? sceneKey(edge.target.seed.id), state);
  }

  private facingChannel(source: EngineNode, target: EngineNode): ChannelRef {
    return target.laneIndex > source.laneIndex
      ? { lane: target.laneIndex, side: "left" }
      : { lane: target.laneIndex, side: "right" };
  }

  private channel(
    edge: EngineEdge,
    channel: ChannelRef,
    entryPreference: "side" | "top",
  ): EdgePlan {
    const source = edge.source;
    const target = edge.target;
    const x = channelX(this.lanes, channel, 0);
    const towards = (node: EngineNode): Side => (x < centerX(node) ? "left" : "right");
    const targetAbove =
      target.row < source.row || (target.row === source.row && target.y < source.y);
    let exit: Side;
    let exitGap: number | null = null;
    if (source.anchor && source.anchor !== target) {
      if (targetAbove && isTopOfStack(source)) {
        exit = "top";
        exitGap = source.row;
      } else if (!targetAbove && isBottomOfStack(source)) {
        exit = "bottom";
        exitGap = source.row + 1;
      } else {
        exit = towards(source);
      }
    } else {
      const side = towards(source);
      if (!this.blocked(source.row, centerY(source), sideX(source, side), x, [source, target])) {
        exit = side;
      } else if (targetAbove) {
        exit = "top";
        exitGap = source.row;
      } else {
        exit = "bottom";
        exitGap = source.row + 1;
      }
    }
    let entry: Side;
    let entryGap: number | null = null;
    const sourceAbove = !targetAbove;
    if (target.anchor && target.anchor !== source) {
      if (sourceAbove && isTopOfStack(target)) {
        entry = "top";
        entryGap = target.row;
      } else if (!sourceAbove && isBottomOfStack(target)) {
        entry = "bottom";
        entryGap = target.row + 1;
      } else {
        entry = towards(target);
      }
    } else if (entryPreference === "top" && sourceAbove) {
      entry = "top";
      entryGap = target.row;
    } else {
      const side = towards(target);
      if (!this.blocked(target.row, centerY(target), sideX(target, side), x, [source, target])) {
        entry = side;
      } else if (sourceAbove) {
        entry = "top";
        entryGap = target.row;
      } else {
        entry = "bottom";
        entryGap = target.row + 1;
      }
    }
    return { type: "channel", channel, exit, exitGap, entry, entryGap };
  }

  /** True when a horizontal line at `y` between x1 and x2 would cross a state in `row`. */
  private blocked(row: number, y: number, x1: number, x2: number, ignore: EngineNode[]): boolean {
    const low = Math.min(x1, x2);
    const high = Math.max(x1, x2);
    return (this.rowNodes[row] ?? []).some(
      (node) =>
        !ignore.includes(node) &&
        node.x < high - 1 &&
        node.x + node.width > low + 1 &&
        node.y - 2 <= y &&
        node.y + node.height + 2 >= y,
    );
  }
}

function edgeKind(edge: EngineEdge): StateMachineLayoutEdgeKind {
  const { plan, source, target } = edge;
  if (plan.type === "self") return "self";
  if (plan.type === "stub") return "stub";
  if (source.anchor || target.anchor) return "detour";
  if (plan.type === "jog" || plan.type === "stack") return "forward";
  if (plan.type === "direct" || plan.type === "under") return "lateral";
  if (source.laneIndex === target.laneIndex) {
    return plan.channel.side === "left" ? "back" : "forward";
  }
  return target.row < source.row ? "back" : "lateral";
}

function channelLevels(edge: EngineEdge): [number, number] {
  if (edge.plan.type !== "channel") return [0, 0];
  const start = edge.plan.exitGap !== null ? edge.plan.exitGap * 2 : edge.source.row * 2 + 1;
  const end = edge.plan.entryGap !== null ? edge.plan.entryGap * 2 : edge.target.row * 2 + 1;
  return [Math.min(start, end), Math.max(start, end)];
}

/** Interval-colors every channel so overlapping vertical runs get distinct tracks (shortest innermost). */
function assignChannelTracks(edges: EngineEdge[], lanes: EngineLane[]): void {
  const byChannel = new Map<string, EngineEdge[]>();
  for (const edge of edges) {
    if (edge.plan.type !== "channel") continue;
    edge.levels = channelLevels(edge);
    pushTo(byChannel, `${edge.plan.channel.lane}:${edge.plan.channel.side}`, edge);
  }
  for (const [key, channelEdges] of byChannel) {
    channelEdges.sort(
      (a, b) =>
        a.levels[1] - a.levels[0] - (b.levels[1] - b.levels[0]) ||
        a.levels[0] - b.levels[0] ||
        a.index - b.index,
    );
    const tracks: Array<Array<[number, number]>> = [];
    for (const edge of channelEdges) {
      let track = tracks.findIndex((spans) =>
        spans.every(([low, high]) => edge.levels[1] < low || edge.levels[0] > high),
      );
      if (track < 0) {
        track = tracks.length;
        tracks.push([]);
      }
      tracks[track]!.push(edge.levels);
      edge.track = track;
    }
    const [laneIndex, side] = key.split(":");
    const lane = lanes[Number(laneIndex)]!;
    if (side === "left") lane.leftTracks = Math.max(lane.leftTracks, tracks.length);
    else lane.rightTracks = Math.max(lane.rightTracks, tracks.length);
  }
}

function edgeChannelX(edge: EngineEdge, lanes: EngineLane[]): number {
  return edge.plan.type === "channel" ? channelX(lanes, edge.plan.channel, edge.track) : 0;
}

function assignPorts(edges: EngineEdge[], lanes: EngineLane[]): void {
  const sides = new Map<string, PortRequest[]>();
  const request = (
    edge: EngineEdge,
    node: EngineNode,
    side: Side,
    key: number,
    pinned = false,
  ): PortRequest => {
    const port: PortRequest = { edge, node, side, key, pinned, offset: 0 };
    pushTo(sides, `${node.order}:${side}`, port);
    return port;
  };
  for (const edge of edges) {
    const { plan, source, target } = edge;
    switch (plan.type) {
      case "self":
        break;
      case "stub":
        edge.startPort = request(edge, source, "left", centerY(source) + 0.5);
        break;
      case "direct": {
        const exit: Side = centerX(target) > centerX(source) ? "right" : "left";
        edge.startPort = request(edge, source, exit, centerY(target));
        edge.endPort = request(edge, target, exit === "right" ? "left" : "right", centerY(source));
        break;
      }
      case "stack": {
        const downwards = source.stackIndex < target.stackIndex;
        edge.startPort = request(edge, source, downwards ? "bottom" : "top", centerX(target));
        edge.endPort = request(edge, target, downwards ? "top" : "bottom", centerX(source));
        break;
      }
      case "jog": {
        const aligned = Math.abs(centerX(source) - centerX(target)) < 0.5;
        edge.startPort = request(edge, source, "bottom", centerX(target), aligned);
        edge.endPort = request(edge, target, "top", centerX(source), aligned);
        break;
      }
      case "under":
        edge.startPort = request(edge, source, "bottom", centerX(target));
        edge.endPort = request(edge, target, "bottom", centerX(source));
        break;
      case "channel": {
        const x = edgeChannelX(edge, lanes);
        const startKey = plan.exit === "top" || plan.exit === "bottom" ? x : centerY(target);
        const endKey = plan.entry === "top" || plan.entry === "bottom" ? x : centerY(source);
        edge.startPort = request(edge, source, plan.exit, startKey);
        edge.endPort = request(edge, target, plan.entry, endKey);
        break;
      }
    }
  }
  for (const requests of sides.values()) {
    const { node, side } = requests[0]!;
    const horizontal = side === "top" || side === "bottom";
    distributePorts(
      requests,
      horizontal ? node.width : node.height,
      horizontal ? PORT_GAP_X : PORT_GAP_Y,
      horizontal ? PORT_INSET_X : PORT_INSET_Y,
    );
  }
  // Keep anchor <-> detour connectors perfectly horizontal: when the detour sits level with its
  // anchor and that side only carries anchor connectors, mirror the anchor's port offsets.
  for (const requests of sides.values()) {
    const { node } = requests[0]!;
    if (!node.anchor || node.y !== node.anchor.y || node.height !== node.anchor.height) continue;
    const anchorEdges = requests.every(
      (port) =>
        port.edge.plan.type === "direct" &&
        (port.edge.source === node.anchor || port.edge.target === node.anchor),
    );
    if (!anchorEdges) continue;
    for (const port of requests) {
      const mirror = port.edge.startPort === port ? port.edge.endPort : port.edge.startPort;
      if (mirror) port.offset = mirror.offset;
    }
  }
}

function distributePorts(
  requests: PortRequest[],
  length: number,
  gap: number,
  inset: number,
): void {
  requests.sort((a, b) => a.key - b.key || a.edge.index - b.edge.index);
  const count = requests.length;
  const center = length / 2;
  const usable = Math.max(0, center - inset);
  const pinnedIndex = requests.findIndex((request) => request.pinned);
  if (pinnedIndex < 0) {
    const step = count > 1 ? Math.min(gap, (usable * 2) / (count - 1)) : 0;
    requests.forEach((request, index) => {
      request.offset = center + (index - (count - 1) / 2) * step;
    });
    return;
  }
  const reach = Math.max(pinnedIndex, count - 1 - pinnedIndex);
  const step = reach ? Math.min(gap, usable / reach) : 0;
  requests.forEach((request, index) => {
    request.offset = center + (index - pinnedIndex) * step;
  });
}

function portPoint(port: PortRequest): Point {
  const { node, side, offset } = port;
  switch (side) {
    case "top":
      return { x: node.x + offset, y: node.y };
    case "bottom":
      return { x: node.x + offset, y: node.y + node.height };
    case "left":
      return { x: node.x, y: node.y + offset };
    case "right":
      return { x: node.x + node.width, y: node.y + offset };
  }
}

function portX(port: PortRequest): number {
  return port.side === "left"
    ? port.node.x
    : port.side === "right"
      ? port.node.x + port.node.width
      : port.node.x + port.offset;
}

/** Interval-colors horizontal runs inside each row gap. Returns the track count per gap. */
function assignGapTracks(edges: EngineEdge[], lanes: EngineLane[]): Map<number, number> {
  const byGap = new Map<number, GapRequest[]>();
  const add = (gap: number, from: number, to: number): GapRequest => {
    const request: GapRequest = {
      gap,
      from: Math.min(from, to),
      to: Math.max(from, to),
      track: 0,
      y: 0,
    };
    pushTo(byGap, gap, request);
    return request;
  };
  for (const edge of edges) {
    const { plan } = edge;
    if (!edge.startPort) continue;
    if (plan.type === "jog" && edge.endPort) {
      const from = portX(edge.startPort);
      const to = portX(edge.endPort);
      if (Math.abs(from - to) > 0.5) edge.midGap = add(edge.target.row, from, to);
    } else if (plan.type === "under" && edge.endPort) {
      edge.midGap = add(edge.source.row + 1, portX(edge.startPort), portX(edge.endPort));
    } else if (plan.type === "channel" && edge.endPort) {
      const x = edgeChannelX(edge, lanes);
      if (plan.exitGap !== null) edge.startGap = add(plan.exitGap, portX(edge.startPort), x);
      if (plan.entryGap !== null) edge.endGap = add(plan.entryGap, x, portX(edge.endPort));
    }
  }
  const counts = new Map<number, number>();
  for (const [gap, requests] of byGap) {
    requests.sort((a, b) => a.to - a.from - (b.to - b.from) || a.from - b.from);
    const tracks: GapRequest[][] = [];
    for (const request of requests) {
      let track = tracks.findIndex((placed) =>
        placed.every((other) => request.to + 4 < other.from || request.from - 4 > other.to),
      );
      if (track < 0) {
        track = tracks.length;
        tracks.push([]);
      }
      tracks[track]!.push(request);
      request.track = track;
    }
    counts.set(gap, tracks.length);
  }
  return counts;
}

/** Builds every edge polyline and arrowhead. Returns the stub badge boxes. */
function buildEdgePoints(edges: EngineEdge[], lanes: EngineLane[]): Box[] {
  const stubBoxes: Box[] = [];
  const stubsByLane = new Map<number, Box[]>();
  const orderedStubs = edges
    .filter((edge) => edge.plan.type === "stub" && edge.startPort)
    .sort(
      (a, b) => portPoint(a.startPort as PortRequest).y - portPoint(b.startPort as PortRequest).y,
    );
  const directJogX = assignDirectJogs(edges, lanes);
  for (const edge of edges) {
    const { plan, source } = edge;
    let points: Point[] = [];
    switch (plan.type) {
      case "self": {
        const right = source.x + source.width;
        points = [
          { x: right, y: source.y + 14 },
          { x: right + 20, y: source.y + 14 },
          { x: right + 20, y: source.y - 16 },
          { x: right - 30, y: source.y - 16 },
          { x: right - 30, y: source.y },
        ];
        break;
      }
      case "stub":
        // Built below, once all stubs are known, so badges can be nudged apart.
        break;
      case "direct": {
        const start = portPoint(edge.startPort as PortRequest);
        const end = portPoint(edge.endPort as PortRequest);
        const middle = directJogX.get(edge) ?? (start.x + end.x) / 2;
        points = [start, { x: middle, y: start.y }, { x: middle, y: end.y }, end];
        break;
      }
      case "stack": {
        const start = portPoint(edge.startPort as PortRequest);
        const end = portPoint(edge.endPort as PortRequest);
        const middle = (start.y + end.y) / 2;
        points = [start, { x: start.x, y: middle }, { x: end.x, y: middle }, end];
        break;
      }
      case "jog":
      case "under": {
        const start = portPoint(edge.startPort as PortRequest);
        const end = portPoint(edge.endPort as PortRequest);
        points = edge.midGap
          ? [start, { x: start.x, y: edge.midGap.y }, { x: end.x, y: edge.midGap.y }, end]
          : [start, end];
        break;
      }
      case "channel": {
        const start = portPoint(edge.startPort as PortRequest);
        const end = portPoint(edge.endPort as PortRequest);
        const x = edgeChannelX(edge, lanes);
        points = [start];
        if (edge.startGap)
          points.push({ x: start.x, y: edge.startGap.y }, { x, y: edge.startGap.y });
        else points.push({ x, y: start.y });
        if (edge.endGap) points.push({ x, y: edge.endGap.y }, { x: end.x, y: edge.endGap.y });
        else points.push({ x, y: end.y });
        points.push(end);
        break;
      }
    }
    if (plan.type !== "stub") finishEdge(edge, points);
  }
  for (const edge of orderedStubs) {
    if (edge.plan.type !== "stub") continue;
    const lane = lanes[edge.source.laneIndex]!;
    const start = portPoint(edge.startPort as PortRequest);
    const width = labelWidthFor(edge.plan.text);
    const height = LABEL_HEIGHT + 2;
    const right = lane.mainX - Math.max(channelWidth(lane.leftTracks), 0) - STUB_CLEARANCE;
    const laneBoxes = stubsByLane.get(edge.source.laneIndex) ?? [];
    let y = start.y;
    for (const box of laneBoxes) {
      if (y - height / 2 < box.y + box.height + 3) y = box.y + box.height + 3 + height / 2;
    }
    const box: Box = { x: right - width, y: y - height / 2, width, height };
    laneBoxes.push(box);
    stubsByLane.set(edge.source.laneIndex, laneBoxes);
    stubBoxes.push(box);
    edge.labelBox = box;
    const points =
      Math.abs(y - start.y) < 0.5
        ? [start, { x: right, y }]
        : [start, { x: right + 12, y: start.y }, { x: right + 12, y }, { x: right, y }];
    finishEdge(edge, points);
  }
  return stubBoxes;
}

/**
 * Side-by-side connections whose ports are not level need a vertical jog. Jogs that share the space
 * between the same pair of columns get distinct x offsets; anchor <-> detour jogs sit in the detour
 * gap, clear of the lane's right channel.
 */
function assignDirectJogs(edges: EngineEdge[], lanes: EngineLane[]): Map<EngineEdge, number> {
  const groups = new Map<string, Array<{ edge: EngineEdge; middle: number }>>();
  for (const edge of edges) {
    if (edge.plan.type !== "direct" || !edge.startPort || !edge.endPort) continue;
    const start = portPoint(edge.startPort);
    const end = portPoint(edge.endPort);
    if (Math.abs(start.y - end.y) < 0.5) continue;
    const detour = edge.source.anchor ? edge.source : edge.target.anchor ? edge.target : null;
    let middle = (start.x + end.x) / 2;
    if (detour) {
      const lane = lanes[detour.laneIndex]!;
      const left = lane.mainX + lane.mainWidth + channelWidth(lane.rightTracks);
      middle = (left + lane.detourX) / 2;
    }
    const left = Math.min(start.x, end.x);
    const right = Math.max(start.x, end.x);
    pushTo(groups, `${edge.source.row}:${Math.round(left)}:${Math.round(right)}`, { edge, middle });
  }
  const result = new Map<EngineEdge, number>();
  for (const group of groups.values()) {
    group.forEach(({ edge, middle }, index) => {
      result.set(edge, middle + (index - (group.length - 1) / 2) * TRACK_GAP);
    });
  }
  return result;
}

/** Simplifies the polyline and splits off an arrowhead that ends exactly on the last point. */
function finishEdge(edge: EngineEdge, rawPoints: Point[]): void {
  const points = simplifyPoints(rawPoints);
  if (points.length < 2) {
    edge.points = points;
    edge.arrow = [];
    return;
  }
  const tip = points[points.length - 1]!;
  const previous = points[points.length - 2]!;
  const length = distance(previous, tip);
  const direction = { x: (tip.x - previous.x) / length, y: (tip.y - previous.y) / length };
  const arrowLength = Math.min(ARROW_LENGTH, Math.max(0, length - 1));
  const base = { x: tip.x - direction.x * arrowLength, y: tip.y - direction.y * arrowLength };
  const normal = { x: -direction.y, y: direction.x };
  edge.arrow = [
    tip,
    { x: base.x + normal.x * ARROW_HALF_WIDTH, y: base.y + normal.y * ARROW_HALF_WIDTH },
    { x: base.x - normal.x * ARROW_HALF_WIDTH, y: base.y - normal.y * ARROW_HALF_WIDTH },
  ];
  // The stroke stops just inside the arrowhead so the line never pokes past the tip.
  const strokeEnd = { x: base.x + direction.x, y: base.y + direction.y };
  edge.points = [...points.slice(0, -1), strokeEnd];
}

function simplifyPoints(points: Point[]): Point[] {
  const deduped: Point[] = [];
  for (const point of points) {
    const last = deduped[deduped.length - 1]!;
    if (!last || distance(last, point) > 0.5) deduped.push(point);
  }
  const output: Point[] = [];
  for (const point of deduped) {
    const length = output.length;
    if (length >= 2) {
      const a = output[length - 2]!;
      const b = output[length - 1]!;
      const collinear =
        (Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - point.x) < 0.5) ||
        (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - point.y) < 0.5);
      if (collinear) output.pop();
    }
    output.push(point);
  }
  return output;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function sceneLaneIndex(block: EngineBlock): number {
  const initial = block.nodes.find((node) => node.seed.initial) ?? block.nodes[0];
  return initial?.laneIndex ?? 0;
}

function sceneHeaderBox(block: EngineBlock, lanes: EngineLane[], rowTop: number[]): Box {
  const lane = lanes[sceneLaneIndex(block)]!;
  const width = 130 + block.label.length * 7.4;
  const top = rowTop[block.firstRow]! - SCENE_HEADER_HEIGHT;
  return { x: lane.mainX + lane.mainWidth / 2 - width / 2, y: top - 2, width, height: 28 };
}

function labelWidthFor(text: string): number {
  return Math.max(24, Math.ceil(text.length * LABEL_CHAR_WIDTH + LABEL_PADDING_X * 2));
}

interface Segment {
  a: Point;
  b: Point;
  edge: EngineEdge;
}

function edgeSegments(edge: EngineEdge): Segment[] {
  const points = edge.arrow.length ? [...edge.points.slice(0, -1), edge.arrow[0]] : edge.points;
  const segments: Segment[] = [];
  for (let index = 1; index < points.length; index += 1) {
    segments.push({ a: points[index - 1]!, b: points[index]!, edge });
  }
  return segments;
}

function inflate(box: Box, amount: number): Box {
  return {
    x: box.x - amount,
    y: box.y - amount,
    width: box.width + amount * 2,
    height: box.height + amount * 2,
  };
}

function overlapArea(a: Box, b: Box): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

function segmentCrossesBox(segment: Segment, box: Box): boolean {
  const minX = Math.min(segment.a.x, segment.b.x);
  const maxX = Math.max(segment.a.x, segment.b.x);
  const minY = Math.min(segment.a.y, segment.b.y);
  const maxY = Math.max(segment.a.y, segment.b.y);
  return maxX > box.x && minX < box.x + box.width && maxY > box.y && minY < box.y + box.height;
}

/** Places each label pill on a straight segment of its edge, avoiding nodes, arrowheads and other labels. */
function placeLabels(edges: EngineEdge[], nodes: EngineNode[], fixedBoxes: Box[]): void {
  const hard: Box[] = [
    ...nodes.map((node) =>
      inflate({ x: node.x, y: node.y, width: node.width, height: node.height }, 3),
    ),
    ...edges
      .filter((edge) => edge.arrow.length)
      .map((edge) => {
        const xs = edge.arrow.map((point) => point.x);
        const ys = edge.arrow.map((point) => point.y);
        return inflate(
          {
            x: Math.min(...xs),
            y: Math.min(...ys),
            width: Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys),
          },
          1,
        );
      }),
    ...fixedBoxes.map((box) => inflate(box, 2)),
  ];
  const allSegments = edges.flatMap((edge) => edgeSegments(edge));
  const placed: Box[] = [];
  for (const edge of edges) {
    if (!edge.label || edge.plan.type === "stub") continue;
    const width = labelWidthFor(edge.label);
    const height = LABEL_HEIGHT;
    const segments = edgeSegments(edge)
      .filter((segment) => distance(segment.a, segment.b) >= 6)
      .sort((a, b) => distance(b.a, b.b) - distance(a.a, a.b))
      .slice(0, 4);
    const candidates: Array<{ x: number; y: number; penalty: number }> = [];
    segments.forEach((segment, segmentIndex) => {
      const vertical = Math.abs(segment.a.x - segment.b.x) < 0.5;
      const length = distance(segment.a, segment.b);
      const extent = vertical ? height : width;
      [0.5, 0.32, 0.68, 0.18, 0.82].forEach((fraction, fractionIndex) => {
        const x = segment.a.x + (segment.b.x - segment.a.x) * fraction;
        const y = segment.a.y + (segment.b.y - segment.a.y) * fraction;
        const base = segmentIndex * 0.08 + fractionIndex * 0.03 + (length < extent ? 0.35 : 0);
        candidates.push({ x, y, penalty: base });
        if (segmentIndex < 2) {
          if (vertical) {
            candidates.push({ x: x + width / 2 + 5, y, penalty: base + 0.45 });
            candidates.push({ x: x - width / 2 - 5, y, penalty: base + 0.5 });
          } else {
            candidates.push({ x, y: y - height / 2 - 4, penalty: base + 0.45 });
            candidates.push({ x, y: y + height / 2 + 4, penalty: base + 0.5 });
          }
        }
      });
    });
    let best: { box: Box; score: number } | null = null;
    for (const candidate of candidates) {
      const box: Box = { x: candidate.x - width / 2, y: candidate.y - height / 2, width, height };
      let overlap = box.y < 2 ? 1000 : 0;
      for (const obstacle of hard) overlap += overlapArea(box, obstacle);
      for (const other of placed) overlap += overlapArea(box, inflate(other, 2));
      let crossings = 0;
      const inner = inflate(box, -1);
      for (const segment of allSegments) {
        if (segment.edge !== edge && segmentCrossesBox(segment, inner)) crossings += 1;
      }
      const score = (overlap > 0 ? 1000 + overlap : 0) + crossings + candidate.penalty;
      if (!best || score < best.score) best = { box, score };
      if (score < 0.05) break;
    }
    if (best) {
      edge.labelBox = best.box;
      placed.push(best.box);
    }
  }
}

function emitEdge(edge: EngineEdge, shift: number): StateMachineLayoutEdge {
  const move = (point: Point): Point => ({ x: point.x + shift, y: point.y });
  const points = edge.points.map(move);
  const arrow = edge.arrow.map(move);
  const label = edge.plan.type === "stub" ? edge.plan.text : edge.label;
  const box = edge.labelBox;
  const fallbackCenter = points.length
    ? points[Math.floor((points.length - 1) / 2)]!
    : { x: 0, y: 0 };
  return {
    id: edge.id,
    sourceId: edge.source.seed.id,
    targetId: edge.target.seed.id,
    path: roundedPath(points),
    arrowPath: arrow.length
      ? `M ${fmt(arrow[0]!.x)} ${fmt(arrow[0]!.y)} L ${fmt(arrow[1]!.x)} ${fmt(arrow[1]!.y)} L ${fmt(arrow[2]!.x)} ${fmt(arrow[2]!.y)} Z`
      : "",
    label,
    labelX: box ? fmt(box.x + shift + box.width / 2) : fallbackCenter.x,
    labelY: box ? fmt(box.y + box.height / 2) : fallbackCenter.y,
    labelWidth: box ? box.width : 0,
    labelHeight: box ? box.height : 0,
    guarded: edge.guarded,
    fallback: edge.fallback,
    exception: edge.exception,
    kind: edge.kind,
  };
}

/** Orthogonal polyline with rounded (quadratic) corners. */
function roundedPath(points: Point[]): string {
  if (points.length < 2) return "";
  const parts = [`M ${fmt(points[0]!.x)} ${fmt(points[0]!.y)}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const next = points[index + 1]!;
    const incoming = distance(previous, current);
    const outgoing = distance(current, next);
    const radius = Math.min(
      CORNER_RADIUS,
      index === 1 ? incoming : incoming / 2,
      index === points.length - 2 ? outgoing : outgoing / 2,
    );
    const before = towardsPoint(current, previous, radius);
    const after = towardsPoint(current, next, radius);
    parts.push(
      `L ${fmt(before.x)} ${fmt(before.y)}`,
      `Q ${fmt(current.x)} ${fmt(current.y)} ${fmt(after.x)} ${fmt(after.y)}`,
    );
  }
  const last = points[points.length - 1]!;
  parts.push(`L ${fmt(last.x)} ${fmt(last.y)}`);
  return parts.join(" ");
}

function towardsPoint(from: Point, to: Point, amount: number): Point {
  const length = distance(from, to);
  if (!length) return from;
  return {
    x: from.x + ((to.x - from.x) / length) * amount,
    y: from.y + ((to.y - from.y) / length) * amount,
  };
}

function fmt(value: number): number {
  return Math.round(value * 10) / 10;
}

function sceneKey(id: string): string {
  return id.split(".")[0] || "";
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function addTo<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  const set = map.get(key);
  if (set) set.add(value);
  else map.set(key, new Set([value]));
}

function humanizeSceneLabel(value: string): string {
  const match = /^scene[-_]?(\d+)$/i.exec(value.trim());
  if (match) {
    return graphWords().scene(match[1]!);
  }
  return humanizeToken(value);
}

function buildNode(
  id: string,
  node: StateMachineStateNode,
  initial: boolean,
  definition: StateMachineDefinition,
  stateIds: Set<string>,
): StateMachineGraphNode {
  const transitions: StateMachineGraphTransition[] = [];
  for (const [event, value] of Object.entries(node.on ?? {})) {
    appendTransitions(transitions, event, value, id, definition, stateIds);
  }
  for (const [delay, value] of Object.entries(node.after ?? {})) {
    appendTransitions(
      transitions,
      S.activities.studioPlayer.map.trigger.after(delay),
      value,
      id,
      definition,
      stateIds,
    );
  }
  if (node.invoke?.onDone) {
    appendTransitions(transitions, "done", node.invoke.onDone, id, definition, stateIds);
  }
  if (node.invoke?.onError) {
    appendTransitions(transitions, "error", node.invoke.onError, id, definition, stateIds);
  }
  return {
    actions: implementationLabels(node.entry),
    description: node.description ?? "",
    id,
    label: stateDisplayLabel(id.split(".").at(-1) ?? id),
    initial,
    final: node.type === "final",
    service: node.invoke?.src ?? "",
    transitions,
  };
}

function appendTransitions(
  output: StateMachineGraphTransition[],
  event: string,
  transitions: StateMachineTransitions,
  sourceId: string,
  definition: StateMachineDefinition,
  stateIds: Set<string>,
): void {
  const entries = Array.isArray(transitions) ? transitions : [transitions];
  for (const transition of entries) {
    const value = transitionValue(transition);
    output.push({
      event,
      guard: value.guard,
      target: value.target,
      targetId: resolveTargetId(value.target, sourceId, definition, stateIds),
    });
  }
}

function transitionValue(transition: StateMachineTransition): { guard: string; target: string } {
  return typeof transition === "string"
    ? { guard: "", target: transition }
    : { guard: implementationLabel(transition.guard), target: transition.target ?? "(internal)" };
}

function implementationLabels(value: StateMachineNamedImplementation | undefined): string[] {
  if (value === undefined) return [];
  const entries = Array.isArray(value) ? value : [value];
  return entries.map((entry) => implementationLabel(entry));
}

function implementationLabel(value: StateMachineImplementationReference | undefined): string {
  if (value === undefined) return "";
  return typeof value === "string" ? value : value.type;
}

function collectStateIds(definition: StateMachineDefinition): Set<string> {
  const ids = new Set<string>();
  const visit = (
    states: Readonly<Record<string, StateMachineStateNode>>,
    parentId: string,
  ): void => {
    for (const [name, state] of Object.entries(states)) {
      const id = parentId ? `${parentId}.${name}` : name;
      ids.add(id);
      if (state.states) visit(state.states, id);
    }
  };
  visit(definition.states, "");
  return ids;
}

function resolveInitialLeafId(
  groupId: string,
  group: StateMachineStateNode,
  stateIds: Set<string>,
): string {
  let id = groupId;
  let state = group;
  while (state.initial && state.states?.[state.initial]) {
    id = `${id}.${state.initial}`;
    state = state.states[state.initial]!;
  }
  return stateIds.has(id) ? id : "";
}

function resolveTargetId(
  target: string,
  sourceId: string,
  definition: StateMachineDefinition,
  stateIds: Set<string>,
): string {
  if (!target || target === "(internal)") return "";
  const anchorPrefix = `#${definition.id}.`;
  let normalized = target.startsWith(anchorPrefix) ? target.slice(anchorPrefix.length) : target;
  if (!stateIds.has(normalized)) {
    const parentId = sourceId.includes(".") ? sourceId.slice(0, sourceId.lastIndexOf(".")) : "";
    const localTarget = parentId ? `${parentId}.${normalized}` : normalized;
    if (stateIds.has(localTarget)) {
      normalized = localTarget;
    }
  }
  return resolveToLeafStateId(normalized, definition, stateIds);
}

function resolveToLeafStateId(
  id: string,
  definition: StateMachineDefinition,
  stateIds: Set<string>,
): string {
  if (!id) return "";
  const segments = id.split(".");
  let currentGroup: StateMachineStateNode | undefined = definition.states[segments[0]!];
  if (!currentGroup) return id;

  for (let i = 1; i < segments.length; i++) {
    currentGroup = currentGroup.states?.[segments[i]!];
    if (!currentGroup) return id;
  }

  let leafId = id;
  while (currentGroup?.initial && currentGroup.states?.[currentGroup.initial]) {
    leafId = `${leafId}.${currentGroup.initial}`;
    currentGroup = currentGroup.states[currentGroup.initial]!;
  }

  return stateIds.has(leafId) ? leafId : id;
}

function splitCamelCase(value: string): string {
  return value.replace(/([a-z\d])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z\d]+)/g, "$1 $2");
}

export function humanizeGuardLabel(guard: string, targetId = ""): string {
  if (!guard && !targetId) return "";
  const rawGuard = guard.split(".").at(-1) ?? guard;
  const guardLower = rawGuard.toLowerCase();
  if (/incorrect|wrong/i.test(guardLower)) return graphWords().guards.incorrect;
  if (/correct|success/i.test(guardLower)) return graphWords().guards.correct;
  if (/hangup|hang_up/i.test(guardLower)) return graphWords().guards.hangUp;
  if (/disengage/i.test(guardLower)) return graphWords().guards.disengaged;
  if (/guided/i.test(guardLower)) return graphWords().guards.guided;
  if (/eventforscene|matches(?:scene|effect)/i.test(guardLower)) {
    if (/(?:incorrect|wrong|retry|error|failed|failure)/i.test(targetId)) {
      return graphWords().guards.incorrect;
    }
    return "";
  }
  const simplified = rawGuard
    .replace(/^(?:is|has)/i, "")
    .replace(/ForScene$/i, "")
    .replace(/Choice$/i, "")
    .trim();
  return humanizeToken(simplified || rawGuard).toLowerCase();
}

export function humanizeEventLabel(event: string): string {
  if (!event) return "";
  const rawEvent = event.split(".").at(-1) ?? event;
  if (/^prompt\.completed$/i.test(event) || /^completed$/i.test(rawEvent))
    return graphWords().promptCompleted;
  if (/^choice\.selected$/i.test(event) || /^choice$/i.test(rawEvent))
    return graphWords().choiceSelected;
  return humanizeToken(rawEvent);
}

function transitionLabel(transition: StateMachineGraphTransition, fallback: boolean): string {
  if (transition.guard) {
    const label = humanizeGuardLabel(transition.guard);
    if (label) return graphWords().guarded(label);
  }
  if (fallback && isCorrelationGuard(transition) && isRecoveryTransition(transition)) {
    return graphWords().guarded(graphWords().guards.incorrect);
  }
  if (fallback) return graphWords().otherwise;
  const eventName = transition.event.split(".").at(-1) ?? transition.event;
  if (/^completed$/i.test(eventName) || /^done$/i.test(eventName)) {
    return graphWords().completed;
  }
  return humanizeToken(eventName);
}

function isFallbackTransition(
  transition: StateMachineGraphTransition,
  hasSiblings: boolean,
): boolean {
  return hasSiblings && (!transition.guard || isCorrelationGuard(transition));
}

function isCorrelationGuard(transition: StateMachineGraphTransition): boolean {
  const guardName = transition.guard.split(".").at(-1) ?? transition.guard;
  return /eventforscene|matches(?:scene|effect)/i.test(guardName);
}

function stateDisplayLabel(value: string): string {
  const attemptMatch = /^(first|second|third)-(prompt|choice|incorrect-feedback)$/.exec(value);
  if (attemptMatch) {
    const attempt = { first: "1", second: "2", third: "3" }[
      attemptMatch[1] as "first" | "second" | "third"
    ];
    const state =
      attemptMatch[2] === "incorrect-feedback"
        ? graphWords().incorrectFeedback
        : humanizeToken(attemptMatch[2]!);
    return `${state} ${attempt}`;
  }
  return humanizeToken(value);
}

export function humanizeToken(value: string): string {
  const spaced = splitCamelCase(value)
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replaceAll(".", " ")
    .trim();
  const lower = spaced.toLowerCase();
  return lower ? `${lower[0]!.toUpperCase()}${lower.slice(1)}` : value;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function countBy<T>(values: T[], key: (value: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const itemKey = key(value);
    counts.set(itemKey, (counts.get(itemKey) ?? 0) + 1);
  }
  return counts;
}

function collectRecoveryLaneIds(
  nodes: StateMachineGraphNode[],
  nodeById: Map<string, StateMachineGraphNode>,
  outcomeIds: Set<string>,
): Set<string> {
  const retryIds = new Set<string>();
  const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]));
  for (const node of nodes) {
    const eventCounts = countBy(node.transitions, (transition) => transition.event);
    const successEvents = new Set(
      node.transitions
        .filter((transition) => isSuccessTransition(transition))
        .map((transition) => transition.event),
    );
    for (const transition of node.transitions) {
      // An unguarded fallback is a recovery branch only when it is the "else" of a success check;
      // fallbacks of other guarded lists (e.g. returning from an interruption) stay in the flow.
      const isFallback =
        (eventCounts.get(transition.event) ?? 0) > 1 &&
        !transition.guard &&
        successEvents.has(transition.event);
      if (
        (isFallback || isRecoveryTransition(transition)) &&
        transition.targetId &&
        transition.targetId !== node.id &&
        !outcomeIds.has(transition.targetId)
      ) {
        retryIds.add(transition.targetId);
      }
    }
  }

  const queue = [...retryIds];
  while (queue.length) {
    const node = nodeById.get(queue.shift() as string);
    if (!node) continue;
    for (const transition of node.transitions) {
      const nextId = transition.targetId;
      const sourceIndex = nodeOrder.get(node.id);
      const targetIndex = nodeOrder.get(nextId);
      if (
        !nextId ||
        retryIds.has(nextId) ||
        outcomeIds.has(nextId) ||
        isSuccessTransition(transition) ||
        (sourceIndex !== undefined && targetIndex !== undefined && targetIndex <= sourceIndex)
      ) {
        continue;
      }
      retryIds.add(nextId);
      queue.push(nextId);
    }
  }
  return retryIds;
}

function collectOutcomeLaneIds(
  nodes: StateMachineGraphNode[],
  nodeById: Map<string, StateMachineGraphNode>,
): Set<string> {
  const outcomeIds = new Set(
    nodes
      .flatMap((node) => node.transitions)
      .filter((transition) => isSuccessTransition(transition) && transition.targetId)
      .map((transition) => transition.targetId),
  );
  const queue = [...outcomeIds];
  while (queue.length) {
    const node = nodeById.get(queue.shift() as string);
    if (!node) continue;
    const continuingTransitions = node.transitions.filter(
      (transition) => !isRecoveryTransition(transition),
    );
    if (continuingTransitions.length !== 1) continue;
    const nextId = continuingTransitions[0]!.targetId;
    if (!nextId || outcomeIds.has(nextId)) continue;
    outcomeIds.add(nextId);
    queue.push(nextId);
  }
  return outcomeIds;
}

function isSuccessTransition(transition: StateMachineGraphTransition): boolean {
  const guard = transition.guard.toLowerCase();
  return !guard.includes("incorrect") && /(?:correct|success)/.test(guard);
}

function isRecoveryTransition(transition: StateMachineGraphTransition): boolean {
  return /(?:incorrect|wrong|retry|guided|error|failed|failure)/i.test(
    `${transition.guard} ${transition.targetId}`,
  );
}

function isRecoveryException(transition: StateMachineGraphTransition): boolean {
  return (
    /(?:^|\.)(?:error|failed|failure)$/i.test(transition.targetId) ||
    /(?:^|\.)(?:error|failed|failure)(?:\.|$)/i.test(transition.event)
  );
}
