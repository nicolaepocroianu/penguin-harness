/**
 * One scene of a state machine drawn the way waf-loom's state machine viewer draws it, from the
 * ported layout (state-machine-graph.ts): lanes for the recovery path, the flow and the happy
 * path, states as cards with their marks and what they run, orthogonal edges with their label
 * pills, external targets as their own cards. Pointing at a state brings its edges forward and
 * fades the rest; choosing one opens the inspector under the drawing.
 *
 * The Preview's behavior map and the State machine section both draw through this component;
 * only the Preview passes a live state. The drawing is scaled as one canvas, so it scrolls in a
 * narrow column, and the percentage fits it to the column's width again.
 */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  CloseButton,
  GlyphIcon,
  ICON_SIZE,
  ICONS,
  IconButton,
  Pill,
  Select,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { toneInk, toneName } from "../../lib/tone";
import { isZoomWheel } from "../../lib/shortcuts/wheel";
import {
  fitZoom,
  machineDefinition,
  phaseDetails,
  stepZoom,
  type MapTrigger,
  type StateMachine,
} from "./state-map";
import {
  buildStateMachineGraph,
  humanizeToken,
  layoutStateMachineGroup,
  type StateMachineLayoutEdge,
  type StateMachineLayoutNode,
} from "./state-machine-graph";

/** A trigger in the author's words; an event keeps the name the module gave it. */
export function triggerText(trigger: MapTrigger): string {
  const words = S.activities.studioPlayer.map.trigger;
  if (trigger.kind === "event") return trigger.name;
  if (trigger.kind === "after") return words.after(trigger.ms);
  return words[trigger.kind];
}

/** Room kept beside a fitted canvas, as Loom keeps it. */
const FIT_MARGIN = 16;

/** One labelled list of the inspector; says "Nothing" rather than vanish. */
function Facts({ label, items }: { label: string; items: ReactNode[] }) {
  return (
    <div>
      <dt className="font-medium text-gray-600 dark:text-gray-400">{label}</dt>
      <dd>
        {items.length ? (
          <ul className="space-y-1">
            {items.map((item, index) => (
              <li key={index} className="break-words">
                {item}
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-gray-500">{S.activities.studioPlayer.map.inspect.nothing}</span>
        )}
      </dd>
    </div>
  );
}

function PhaseInspector({
  machine,
  sceneId,
  phaseId,
  onChoose,
  onClose,
}: {
  machine: StateMachine;
  sceneId: string;
  phaseId: string;
  onChoose: (phase: string) => void;
  onClose: () => void;
}) {
  const words = S.activities.studioPlayer.map.inspect;
  const details = phaseDetails(machine, sceneId, phaseId);
  if (!details) return null;
  const link = (phase: string) => (
    <button
      type="button"
      className="text-brand-600 hover:text-brand-700 dark:text-brand-300"
      onClick={() => onChoose(phase)}
    >
      {phase}
    </button>
  );
  return (
    <section
      aria-label={words.title(details.id)}
      className="space-y-2 rounded-lg border border-gray-200 p-3 text-xs dark:border-gray-800"
    >
      <div className="flex items-center gap-2">
        <h5 className="min-w-0 flex-1 font-semibold break-all">{words.title(details.id)}</h5>
        <CloseButton onClose={onClose} label={words.close} />
      </div>
      {(details.initial || details.final) && (
        <p className="text-gray-500">
          {[details.initial && words.initial, details.final && words.final]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      <dl className="grid gap-2 sm:grid-cols-2">
        <Facts label={words.entry} items={details.entry} />
        <Facts label={words.exit} items={details.exit} />
        <Facts label={words.invokes} items={details.invokes} />
        <Facts
          label={words.incoming}
          items={details.incoming.map((edge) => (
            <>
              {link(edge.from)}, {words.via(triggerText(edge.trigger))}
            </>
          ))}
        />
        <Facts
          label={words.outgoing}
          items={details.outgoing.map((edge) =>
            edge.leaves ? (
              words.leaves(triggerText(edge.trigger), edge.to)
            ) : (
              <>
                {words.via(triggerText(edge.trigger))}, {words.to} {link(edge.to)}
              </>
            ),
          )}
        />
      </dl>
    </section>
  );
}

/**
 * A target outside the scene, named the way the scene reads it: without the `#`, the machine's
 * own id or the dots of its path. The full id stays on the card's hint.
 */
export function externalLabel(id: string, machineId: string): string {
  const bare = id.replace(/^#/, "");
  const local =
    machineId && bare.startsWith(`${machineId}.`) ? bare.slice(machineId.length + 1) : bare;
  return local
    .split(".")
    .filter(Boolean)
    .map((part) => humanizeToken(part))
    .join(" › ");
}

/** The last part of a dotted implementation name, as Loom's chips show it. */
const leaf = (name: string) => name.split(".").pop() || name;

/** Ink of an edge by what it is, through its `currentColor`. */
function edgeInk(edge: StateMachineLayoutEdge, active: boolean, related: boolean): string {
  if (active) return "text-brand-600 dark:text-brand-300";
  if (edge.exception) return toneInk.danger;
  if (related) return "text-gray-700 dark:text-gray-200";
  if (edge.guarded) return "text-gray-500 dark:text-gray-400";
  return "text-gray-400 dark:text-gray-500";
}

function edgeDash(edge: StateMachineLayoutEdge): string | undefined {
  if (edge.exception) return "2 4";
  if (edge.fallback) return "4 3";
  if (edge.kind === "stub") return "3 3";
  return undefined;
}

export function MachineDiagram({
  machine,
  sceneId,
  scenes,
  onScene,
  activeState = null,
  liveCount = 0,
  fill = false,
}: {
  machine: StateMachine;
  /** The scene drawn: one group of the machine, as Loom's preview draws the scene playing. */
  sceneId: string;
  /** The scenes to choose from; a choice shows when there is more than one. */
  scenes: readonly string[];
  onScene: (sceneId: string) => void;
  /** The state the activity reports itself in, as `<scene>.<phase>`; null where nothing plays. */
  activeState?: string | null;
  /** How many tap targets the player reports for the live state, marked on its card. */
  liveCount?: number;
  /** Fill the height it is given instead of a bounded drawing (a section of its own). */
  fill?: boolean;
}) {
  const words = S.activities.studioPlayer.map;
  const helpId = useId();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const measure = (width: number) => {
      const rounded = Math.round(width);
      if (rounded > 0) setViewportWidth(rounded);
    };
    measure(element.clientWidth);
    const observer = new ResizeObserver((entries) => measure(entries[0]?.contentRect.width ?? 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const definition = useMemo(() => machineDefinition(machine), [machine]);
  const groups = useMemo(() => buildStateMachineGraph(definition), [definition]);
  const group = groups.find((entry) => entry.id === sceneId) ?? null;
  const layout = useMemo(
    () => (group ? layoutStateMachineGroup(group, viewportWidth) : null),
    [group, viewportWidth],
  );

  // The zoom follows the column until the author zooms; the percentage hands it back.
  const [zoom, setZoom] = useState(1);
  const [fitted, setFitted] = useState(true);
  const fit = layout ? fitZoom(viewportWidth - FIT_MARGIN, layout.width) : null;
  useEffect(() => setFitted(true), [sceneId]);
  useEffect(() => {
    if (fitted && fit !== null) setZoom(fit);
  }, [fitted, fit]);
  const zoomBy = (direction: 1 | -1) => {
    setFitted(false);
    setZoom((current) => stepZoom(current, direction));
  };

  const [inspected, setInspected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  useEffect(() => {
    setInspected(null);
    setHovered(null);
  }, [sceneId]);

  // The transition the activity last took, drawn as live (Loom's active edge).
  const previous = useRef<string | null>(null);
  const [taken, setTaken] = useState<{ from: string; to: string } | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = activeState;
    setTaken(
      activeState && before && before !== activeState ? { from: before, to: activeState } : null,
    );
  }, [activeState]);
  const takenOnce =
    !!taken &&
    !!layout &&
    layout.edges.filter((edge) => edge.sourceId === taken.from && edge.targetId === taken.to)
      .length === 1;
  const isTaken = (edge: StateMachineLayoutEdge) =>
    takenOnce && edge.sourceId === taken!.from && edge.targetId === taken!.to;

  // The live state's card is kept in view as the activity moves on.
  useEffect(() => {
    const viewport = viewportRef.current;
    const node = layout?.nodes.find((entry) => entry.id === activeState);
    if (!viewport || !node) return;
    const top = node.y * zoom;
    const bottom = (node.y + node.height) * zoom;
    if (top < viewport.scrollTop) viewport.scrollTop = Math.max(0, top - 24);
    else if (bottom > viewport.scrollTop + viewport.clientHeight)
      viewport.scrollTop = bottom - viewport.clientHeight + 24;
  }, [activeState, layout, zoom]);

  const related = useMemo(() => {
    const ids = new Set<string>();
    for (const edge of layout?.edges ?? []) {
      if (edge.sourceId === hovered) ids.add(edge.targetId);
      if (edge.targetId === hovered) ids.add(edge.sourceId);
    }
    return ids;
  }, [layout, hovered]);
  const isRelated = (edge: StateMachineLayoutEdge) =>
    hovered !== null && (edge.sourceId === hovered || edge.targetId === hovered);
  // Related and live edges paint last, above the rest.
  const ordered = useMemo(() => {
    const weight = (edge: StateMachineLayoutEdge) =>
      (isTaken(edge) ? 2 : 0) + (isRelated(edge) ? 1 : 0);
    return (layout?.edges ?? [])
      .map((edge, index) => ({ edge, index }))
      .sort((a, b) => weight(a.edge) - weight(b.edge) || a.index - b.index)
      .map((entry) => entry.edge);
  }, [layout, hovered, taken, takenOnce]);

  const phaseOf = (id: string) =>
    id.startsWith(`${sceneId}.`) ? id.slice(sceneId.length + 1) : id;
  const tabbable = (id: string) => {
    if (!layout) return false;
    if (inspected) return inspected === id;
    if (activeState && layout.nodes.some((node) => node.id === activeState))
      return activeState === id;
    return layout.nodes[0]?.id === id;
  };
  function onNodeKey(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (event.key === "Escape" && inspected === id) {
      event.stopPropagation();
      setInspected(null);
      return;
    }
    const nodes = layout?.nodes ?? [];
    const at = nodes.findIndex((node) => node.id === id);
    let to = at;
    if (event.key === "ArrowDown" || event.key === "ArrowRight")
      to = Math.min(nodes.length - 1, at + 1);
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") to = Math.max(0, at - 1);
    else if (event.key === "Home") to = 0;
    else if (event.key === "End") to = nodes.length - 1;
    else return;
    event.preventDefault();
    const next = nodes[to];
    if (!next || to === at) return;
    setInspected(null);
    viewportRef.current
      ?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(next.id)}"]`)
      ?.focus();
  }

  const percent = words.zoomLevel(Math.round(zoom * 100));
  const nodeLabel = (node: StateMachineLayoutNode) =>
    node.external ? externalLabel(node.id, machine.id) : node.label;

  return (
    <div className={fill ? "flex min-h-0 flex-1 flex-col gap-2" : "space-y-2"}>
      <div className="flex items-center gap-2">
        {scenes.length > 1 && (
          <div className="w-40 min-w-0">
            <Select
              size="sm"
              aria-label={words.scene}
              value={sceneId}
              onChange={(event) => onScene(event.target.value)}
            >
              {scenes.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div role="group" aria-label={words.zoom} className="ml-auto flex items-center">
          <IconButton
            size="sm"
            variant="ghost"
            label={words.zoomOut}
            disabled={stepZoom(zoom, -1) === zoom}
            onClick={() => zoomBy(-1)}
          >
            <GlyphIcon d={ICONS.minus} size={ICON_SIZE.iconButton} />
          </IconButton>
          {/* The reading is the way back: it fits the drawing to the column (Loom's preview). */}
          <button
            type="button"
            aria-label={`${words.zoomFit} · ${percent}`}
            data-tooltip={words.zoomFit}
            disabled={fitted}
            onClick={() => setFitted(true)}
            className="min-w-11 rounded-md px-1 py-1 text-center text-xs text-gray-600 tabular-nums transition-colors duration-150 hover:bg-gray-100 hover:text-gray-900 disabled:hover:bg-transparent disabled:hover:text-gray-600 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100 dark:disabled:hover:text-gray-300"
          >
            {percent}
          </button>
          <IconButton
            size="sm"
            variant="ghost"
            label={words.zoomIn}
            disabled={stepZoom(zoom, 1) === zoom}
            onClick={() => zoomBy(1)}
          >
            <GlyphIcon d={ICONS.plus} size={ICON_SIZE.iconButton} />
          </IconButton>
        </div>
      </div>
      <div
        ref={viewportRef}
        className={`overflow-auto overscroll-contain rounded-lg border border-gray-200 bg-gray-50/60 dark:border-gray-800 dark:bg-gray-950 ${
          fill ? "min-h-0 flex-1" : "max-h-[32rem]"
        }`}
        onWheel={(event) => {
          if (!isZoomWheel(event)) return;
          event.preventDefault();
          zoomBy(event.deltaY < 0 ? 1 : -1);
        }}
      >
        {layout && (
          <div
            className="relative mx-auto"
            style={{ width: layout.width * zoom, height: layout.height * zoom }}
          >
            <div
              role="group"
              aria-label={words.graph(sceneId)}
              aria-describedby={helpId}
              className="absolute top-0 left-0 origin-top-left"
              style={{
                width: layout.width,
                height: layout.height,
                transform: `scale(${zoom})`,
              }}
            >
              <span id={helpId} className="sr-only">
                {words.canvasHelp}
              </span>
              {layout.lanes.map((lane) => (
                <div
                  key={lane.id}
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 border-x border-dashed border-gray-200 dark:border-gray-800"
                  style={{ left: lane.x, width: lane.width }}
                >
                  {layout.lanes.length > 1 && (
                    <span className="absolute top-3 left-2 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs whitespace-nowrap text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
                      {lane.label}
                    </span>
                  )}
                </div>
              ))}
              <svg
                aria-hidden
                className="pointer-events-none absolute inset-0 overflow-visible"
                width={layout.width}
                height={layout.height}
                viewBox={`0 0 ${layout.width} ${layout.height}`}
              >
                <g>
                  {ordered.map((edge) => {
                    const active = isTaken(edge);
                    const near = isRelated(edge);
                    return (
                      <g
                        key={edge.id}
                        data-edge-kind={edge.kind}
                        className={`transition-opacity duration-150 ${edgeInk(edge, active, near)}`}
                        opacity={edge.exception ? 0.3 : hovered !== null && !near ? 0.15 : 1}
                      >
                        <path
                          d={edge.path}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={near || active ? 2.4 : edge.guarded ? 1.8 : 1.6}
                          strokeDasharray={edgeDash(edge)}
                          strokeLinejoin="round"
                          vectorEffect="non-scaling-stroke"
                        />
                        <path d={edge.arrowPath} fill="currentColor" />
                      </g>
                    );
                  })}
                </g>
                {/* Label pills paint after every line, so no line runs across a label. */}
                <g>
                  {ordered.map((edge) =>
                    edge.label && edge.labelWidth ? (
                      <g
                        key={edge.id}
                        className={`transition-opacity duration-150 ${edgeInk(edge, isTaken(edge), isRelated(edge))}`}
                        opacity={hovered !== null && !isRelated(edge) ? 0.15 : 1}
                      >
                        <rect
                          x={edge.labelX - edge.labelWidth / 2}
                          y={edge.labelY - edge.labelHeight / 2}
                          width={edge.labelWidth}
                          height={edge.labelHeight}
                          rx={edge.labelHeight / 2}
                          stroke="currentColor"
                          strokeDasharray={edge.kind === "stub" ? "3 2" : undefined}
                          vectorEffect="non-scaling-stroke"
                          className="fill-white dark:fill-gray-900"
                        />
                        <text
                          x={edge.labelX}
                          y={edge.labelY}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fontSize="10"
                          className="fill-gray-700 font-medium dark:fill-gray-200"
                        >
                          {edge.label}
                        </text>
                      </g>
                    ) : null,
                  )}
                </g>
              </svg>
              {layout.nodes.map((node) => {
                const live = node.id === activeState;
                const chosen = node.id === inspected;
                const dimmed =
                  hovered !== null && node.id !== hovered && !live && !related.has(node.id);
                const label = nodeLabel(node);
                const action = node.actions[0];
                return (
                  <button
                    key={node.id}
                    type="button"
                    data-node-id={node.id}
                    tabIndex={tabbable(node.id) ? 0 : -1}
                    aria-current={live ? "step" : undefined}
                    aria-expanded={node.external ? undefined : chosen}
                    aria-label={
                      live
                        ? words.live(label) + (liveCount ? `, ${words.liveCount(liveCount)}` : "")
                        : label
                    }
                    data-tooltip={node.description ? `${node.id}: ${node.description}` : node.id}
                    data-tooltip-extra
                    onClick={() => !node.external && setInspected(chosen ? null : node.id)}
                    onKeyDown={(event) => onNodeKey(event, node.id)}
                    onMouseEnter={() => setHovered(node.id)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(node.id)}
                    onBlur={() => setHovered(null)}
                    className={`absolute flex flex-col justify-center gap-1 rounded-lg px-3 py-2 text-left transition-[opacity,box-shadow] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                      node.external
                        ? "border border-dashed border-gray-300 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                        : live
                          ? "border-2 border-brand-500 bg-brand-50 text-brand-900 dark:bg-brand-950 dark:text-brand-100"
                          : "border border-gray-300 bg-white text-gray-800 hover:border-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                    } ${chosen ? "ring-2 ring-brand-500/60" : ""} ${dimmed ? "opacity-40" : ""}`}
                    style={{ left: node.x, top: node.y, width: node.width, minHeight: node.height }}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold">{label}</span>
                      {node.initial && <Pill>{words.badges.start}</Pill>}
                      {node.final && <Pill>{words.badges.final}</Pill>}
                      {node.external && <Pill>{words.badges.external}</Pill>}
                      {live && liveCount > 0 && (
                        <Pill tone={toneName.busy} tooltip={words.liveCount(liveCount)}>
                          {liveCount}
                        </Pill>
                      )}
                    </span>
                    {(action || node.service) && (
                      <span
                        className="flex min-w-0 items-center gap-1 text-xs text-gray-500 dark:text-gray-400"
                        data-tooltip={
                          action ? words.actionTitle(action) : words.serviceTitle(node.service)
                        }
                      >
                        <GlyphIcon
                          d={action ? ICONS.zap : ICONS.gear}
                          size={ICON_SIZE.inlineGlyph}
                          className="shrink-0"
                        />
                        <span className="min-w-0 truncate">{leaf(action || node.service)}</span>
                        {node.actions.length > 1 && (
                          <span className="shrink-0 tabular-nums">
                            {words.more(node.actions.length - 1)}
                          </span>
                        )}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {inspected && (
        <PhaseInspector
          machine={machine}
          sceneId={sceneId}
          phaseId={phaseOf(inspected)}
          onChoose={(phase) => setInspected(`${sceneId}.${phase}`)}
          onClose={() => setInspected(null)}
        />
      )}
    </div>
  );
}
