import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SandboxBuildReport, SandboxStatus } from "@prismshadow/penguin-server/api";
import { StateMapView } from "./state-map-view";
import { S } from "../../lib/strings";
import { toneStrip } from "../../lib/tone";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { PREVIEW_RESOLUTIONS, fitScale, parseResolution, sceneIds } from "./preview";
import { useActivityClient } from "./activity-client";
import { playUrl } from "./sandbox";
import { SidePanelFill } from "./side-panel-fill";
import {
  highlightMessage,
  pickModeMessage,
  readPlayerMedia,
  readPlayerPick,
  readPlayerReport,
  type PlayerPick,
  type PlayerReport,
} from "./player-bridge";
import {
  IDLE_CLOCK,
  clockAfterMedia,
  clockAfterReport,
  playView,
  sceneOfLine,
  tapNow,
  type LinePick,
  type PlayClock,
  type PlayScene,
  type Sounding,
} from "./play-model";
import { PlayNow } from "./play-now";
import { PlayTimeline } from "./play-timeline";
import {
  MAP_GUTTER,
  MAP_MIN,
  PLAYER_MIN,
  clampMapWidth,
  mapMaxFor,
  sideBySide,
  stepMapWidth,
} from "./map-split";
import {
  setMapVisible,
  setMapWidth as rememberMapWidth,
  useMapVisible,
  useMapWidth,
} from "./map-prefs";

/** How long a playing module may stay quiet before the panel stops waiting for a report. */
const SILENT_AFTER_MS = 8000;
/** How often the lit word moves while a line is being said. */
const WORD_TICK_MS = 80;

/**
 * Opens what an author picked in the player, answering the name of what it opened, or null
 * when nothing in the activity is named the way the picked element is.
 */
export type OnPick = (pick: PlayerPick, sceneId: string | null) => string | null;

/**
 * The player's scenes and lines, and how they meet the Script: the line an author chose
 * (there or here), a way to choose one here, and a way to hear which line is being said.
 */
export interface PlayLink {
  scenes: readonly PlayScene[];
  pick: LinePick | null;
  onLine?: (key: string) => void;
  onSounding?: (sounding: Sounding | null) => void;
}

const NO_PLAY: PlayLink = { scenes: [], pick: null };

/**
 * The activity's preview, the way Loom's is: it builds what it needs and plays, with nothing
 * to press. A module no one has built yet is built on sight; a stale one is rebuilt by the
 * play page itself. A saved draft changes `revision`, which plays the new module.
 *
 * Only what an author can act on is said: why there is nothing to play, a build running, a
 * build that failed with its output. A preview that plays needs no caption.
 */
export function SandboxPanel({
  projectId,
  activityId,
  revision,
  moduleRunId = null,
  spec,
  languages,
  onPick,
  hasMedia = true,
  play = NO_PLAY,
}: {
  projectId: string;
  activityId: string;
  /** The draft's revision; a new one rebuilds and replays. */
  revision: string;
  /** The successful assembly the sandbox selects, honoring a pinned build. */
  moduleRunId?: string | null;
  spec: Record<string, unknown> | null;
  languages: string[];
  onPick?: OnPick;
  /** Whether the activity has a media plan, without which there is nothing to pick. */
  hasMedia?: boolean;
  play?: PlayLink;
}) {
  const { api } = useActivityClient();
  const base = `${api.endpoint}/sandbox`;
  const [status, setStatus] = useState<SandboxStatus | null>(null);
  const [report, setReport] = useState<SandboxBuildReport | null>(null);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The revision the panel last built on sight for, so a failed build is not retried in a
  // loop: the author's next save, or Build again, is what tries again.
  const tried = useRef<string | null>(null);

  // A read here follows a build or a new revision, so it never joins one of the page's polls,
  // which may have started before either.
  const refresh = useCallback(async () => {
    try {
      const next = await api.sandbox.status();
      setStatus(next);
      setError(null);
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    }
  }, [api]);

  const build = useCallback(
    async (force: boolean) => {
      setBuilding(true);
      setError(null);
      try {
        setReport(await api.sandbox.build(force));
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBuilding(false);
      }
    },
    [api, refresh],
  );

  useEffect(() => {
    let live = true;
    setReport(null);
    setError(null);
    void refresh().then((next) => {
      if (!live || !next) return;
      // Nothing to play yet but something to build: build it, once per revision.
      const buildKey = `${base}:${revision}:${moduleRunId ?? ""}`;
      if (!next.playable && next.buildable && tried.current !== buildKey) {
        tried.current = buildKey;
        void build(false);
      }
    });
    return () => {
      live = false;
    };
  }, [refresh, build, revision, moduleRunId, base]);

  if (!status && !error) return null;
  const failed = report?.ok === false;
  const log = failed ? report.log : null;

  return (
    <section className="space-y-3">
      {building ? (
        <p role="status" className={`rounded-md border p-3 text-xs ${toneStrip.muted}`}>
          {S.activities.sandboxBuilding}
        </p>
      ) : (
        status &&
        !status.playable &&
        !failed && (
          <p role="status" className={`rounded-md border p-3 text-xs ${toneStrip.muted}`}>
            {status.message}
          </p>
        )
      )}
      {failed && (
        <div role="alert" className={`space-y-2 rounded-md border p-3 text-xs ${toneStrip.danger}`}>
          <p>{report.message}</p>
          <Button size="sm" onClick={() => void build(true)} disabled={building}>
            {S.activities.sandboxBuildAgain}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className={`rounded-md border p-3 text-xs ${toneStrip.danger}`}>
          {error}
        </p>
      )}
      {status?.playable && !building && (
        <SandboxPlayer
          projectId={projectId}
          activityId={activityId}
          revision={`${revision}:${moduleRunId ?? ""}`}
          spec={spec}
          languages={languages}
          onPick={onPick}
          hasMedia={hasMedia}
          play={play}
        />
      )}
      {log && (
        <details open>
          <summary className="cursor-pointer text-xs text-gray-500">
            {S.activities.sandboxLog}
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-gray-200 bg-gray-50 p-3 text-xs whitespace-pre-wrap dark:border-gray-800 dark:bg-gray-900">
            {log}
          </pre>
        </details>
      )}
    </section>
  );
}

/**
 * The activity, playing as soon as the panel opens, with its scenes as a timeline under it and
 * the shown scene's lines (play-now.tsx) beside it when there is room, under it when not.
 *
 * Filling the workspace, the panel is Play mode: the player fits the height left under its
 * controls and the timeline as well as the width, so the whole screen shows, and the lines and
 * the behavior map share the column beside it.
 */
function SandboxPlayer({
  projectId,
  activityId,
  revision,
  spec,
  languages,
  onPick,
  hasMedia,
  play,
}: {
  projectId: string;
  activityId: string;
  revision: string;
  spec: Record<string, unknown> | null;
  languages: string[];
  onPick?: OnPick;
  hasMedia: boolean;
  play: PlayLink;
}) {
  const own = parseResolution((spec?.runtime as Record<string, unknown> | undefined)?.resolution);
  // Another screen to try the activity at; empty plays it at its own resolution.
  const [resolution, setResolution] = useState("");
  const viewport = resolution ? parseResolution(resolution) : own;
  const scenes = sceneIds(spec);
  const [scene, setScene] = useState("");
  const [language, setLanguage] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  // What the playing activity last reported about itself (see player-bridge.ts), and the
  // tap target an author asked to see outlined.
  const [report, setReport] = useState<PlayerReport | null>(null);
  const [outlined, setOutlined] = useState<string | null>(null);
  // Picking chooses one element and then hands the activity back, the way a browser's
  // element inspector does: a second click should play, not pick again.
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  // The behavior map is shown until an author hides it: it is how a state is read. Both
  // whether it is shown and how wide it is beside the player outlast the page.
  // Shared with the workspace's layouts, which may change either while the player is open.
  const showMap = useMapVisible();
  const storedMapWidth = useMapWidth();
  const [mapWidth, setMapWidth] = useState(storedMapWidth);
  useEffect(() => setMapWidth(storedMapWidth), [storedMapWidth]);
  const [dragging, setDragging] = useState(false);
  // A tap target pointed at in the map, outlined while the pointer or focus stays on it.
  const [previewed, setPreviewed] = useState<string | null>(null);
  const sceneRef = useRef<string | null>(null);
  sceneRef.current = report?.state.sceneId ?? null;
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const hasMediaRef = useRef(hasMedia);
  hasMediaRef.current = hasMedia;
  // Only modules built on Loom's state machine report their state. One that has said
  // nothing for a while is not going to, and "not yet" would be a promise it cannot keep.
  const [silent, setSilent] = useState(false);
  // What this run of the activity has said about its scenes and clips (play-model.ts).
  const [clock, setClock] = useState<PlayClock>(IDLE_CLOCK);
  const [now, setNow] = useState(() => Date.now());
  // While a line is being said, its word moves on with the time since it started.
  const sounding = clock.audio;
  useEffect(() => {
    if (!sounding) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), WORD_TICK_MS);
    return () => clearInterval(timer);
  }, [sounding]);
  const scenesRef = useRef(play.scenes);
  scenesRef.current = play.scenes;
  const onSoundingRef = useRef(play.onSounding);
  onSoundingRef.current = play.onSounding;
  // The Script hears which line is being said, and only a line the player walks.
  const saying =
    sounding && sceneOfLine(scenesRef.current, sounding.key) !== null ? sounding : null;
  useEffect(() => {
    onSoundingRef.current?.(saying);
  }, [saying]);
  useEffect(() => () => onSoundingRef.current?.(null), []);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const frame = frameRef.current?.contentWindow;
      const next = readPlayerReport(event.data, event.source, frame);
      if (next) {
        setReport(next);
        setClock((clock) => clockAfterReport(clock, next, Date.now()));
        return;
      }
      const media = readPlayerMedia(event.data, event.source, frame);
      if (media) {
        setClock((clock) => clockAfterMedia(clock, media, Date.now()));
        return;
      }
      const pick = readPlayerPick(event.data, event.source, frame);
      if (!pick) return;
      setPicking(false);
      frame?.postMessage(pickModeMessage(false), "*");
      const opened = pickRef.current?.(pick, sceneRef.current) ?? null;
      setPicked(
        opened
          ? S.activities.studioPlayer.opened(opened)
          : !hasMediaRef.current
            ? S.activities.studioPlayer.noMedia
            : S.activities.studioPlayer.noMatch(pick.id ?? pick.interactableId ?? ""),
      );
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  function togglePicking() {
    const next = !picking;
    setPicking(next);
    setPicked(null);
    frameRef.current?.contentWindow?.postMessage(pickModeMessage(next), "*");
  }
  // A reload or a different start is a new run of the activity: the last run's state and
  // outline describe nothing on screen any more.
  useEffect(() => {
    setReport(null);
    setClock(IDLE_CLOCK);
    setOutlined(null);
    setPreviewed(null);
    setPicking(false);
    setPicked(null);
    setSilent(false);
    const timer = setTimeout(() => setSilent(true), SILENT_AFTER_MS);
    return () => clearTimeout(timer);
  }, [reloadKey, revision, scene, language]);
  function sendOutline(id: string | null) {
    // The page may sit on the preview origin or, sandboxed, on no origin at all, so there
    // is no origin to name. The message is an id and nothing else; the page accepts it
    // only from this window.
    frameRef.current?.contentWindow?.postMessage(highlightMessage(id), "*");
  }
  function outline(id: string) {
    const next = outlined === id ? null : id;
    setOutlined(next);
    sendOutline(previewed ?? next);
  }
  function preview(id: string | null) {
    setPreviewed(id);
    sendOutline(id ?? outlined);
  }
  // A state change can take away the target being pointed at before the pointer leaves it,
  // and a button that is gone never reports leaving.
  useEffect(() => {
    if (!previewed) return;
    if (report?.interactables.some((entry) => entry.id === previewed)) return;
    setPreviewed(null);
    frameRef.current?.contentWindow?.postMessage(highlightMessage(outlined), "*");
  }, [report, previewed, outlined]);
  function toggleMap() {
    setMapVisible(!showMap);
  }
  const [boxWidth, setBoxWidth] = useState(0);
  useLayoutEffect(() => {
    const element = boxRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setBoxWidth(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // The player's whole area, measured to decide whether the map fits beside the player.
  const areaRef = useRef<HTMLDivElement | null>(null);
  const [areaWidth, setAreaWidth] = useState(0);
  useLayoutEffect(() => {
    const element = areaRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setAreaWidth(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // Filling the workspace, the stage fits the height under its controls: the panel body's
  // height, less where the stage starts in it and a margin below. The player takes what the
  // timeline under it leaves.
  const fill = useContext(SidePanelFill);
  const belowRef = useRef<HTMLDivElement | null>(null);
  const [stageHeight, setStageHeight] = useState(0);
  const [belowHeight, setBelowHeight] = useState(0);
  useLayoutEffect(() => {
    const body = fill.body;
    const element = areaRef.current;
    if (!fill.expanded || !body || !element) {
      setStageHeight(0);
      return;
    }
    const measure = () => {
      const top =
        element.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
      setStageHeight(Math.max(240, body.clientHeight - top - 16));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [fill.expanded, fill.body]);
  useLayoutEffect(() => {
    const element = belowRef.current;
    if (!element) return;
    const measure = () => setBelowHeight(element.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const fitHeight = stageHeight ? Math.max(120, stageHeight - belowHeight - 12) : 0;
  // The lines (and the map, when shown) sit beside the player whenever there is room.
  const split = sideBySide(areaWidth);
  // Play mode: the stage fills the panel, and the column beside it scrolls on its own.
  const stage = fill.expanded && split && stageHeight > 0;
  const appliedMapWidth = clampMapWidth(mapWidth, areaWidth);
  // The drag in progress: the divider holding the pointer, and where the drag started.
  const dragRef = useRef<{
    element: HTMLDivElement;
    pointerId: number;
    startX: number;
    startWidth: number;
    width: number;
  } | null>(null);
  const endDrag = useCallback((keep: boolean) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDragging(false);
    try {
      if (drag.element.hasPointerCapture(drag.pointerId))
        drag.element.releasePointerCapture(drag.pointerId);
    } catch {
      // The element may already be gone, and its capture with it.
    }
    if (keep) rememberMapWidth(drag.width);
  }, []);
  // A drag cut short by the player stopping, or the panel closing, lets the pointer go.
  useEffect(() => () => endDrag(false), [endDrag]);
  useEffect(() => {
    if (!split) endDrag(false);
  }, [split, endDrag]);
  function onDividerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    endDrag(true);
    event.preventDefault();
    const element = event.currentTarget;
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // Without capture the drag still follows the pointer while it stays on the divider.
    }
    dragRef.current = {
      element,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: appliedMapWidth,
      width: appliedMapWidth,
    };
    setDragging(true);
  }
  function onDividerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // The map is to the right of the divider: moving left widens it.
    const next = clampMapWidth(drag.startWidth - (event.clientX - drag.startX), areaWidth);
    drag.width = next;
    setMapWidth(next);
  }
  function onDividerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    endDrag(true);
  }
  function onDividerKey(event: React.KeyboardEvent<HTMLDivElement>) {
    // From the width on screen, which a narrow panel may hold below the remembered one.
    const next = stepMapWidth(appliedMapWidth, event.key, areaWidth);
    if (next === null) return;
    event.preventDefault();
    setMapWidth(next);
    rememberMapWidth(next);
  }
  // On the stage the activity grows to fill it, up to twice its own size.
  const scale = fitScale(
    viewport,
    { width: boxWidth, height: fitHeight || viewport.height },
    stage ? 2 : 1,
  );
  const url = playUrl(projectId, activityId, {
    scene: scene || undefined,
    language: language || undefined,
  });
  const view = playView(play.scenes, clock, play.pick, now);
  const shown = play.scenes.find((entry) => entry.sceneId === view.sceneId) ?? null;
  /** Play the activity again, from a scene or from where it starts. */
  function playFrom(sceneId: string) {
    setScene(sceneId);
    setReloadKey((value) => value + 1);
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {scenes.length > 0 && play.scenes.length === 0 && (
          <Select
            size="sm"
            aria-label={S.activities.previewScene}
            value={scene}
            onChange={(event) => setScene(event.target.value)}
          >
            <option value="">{S.activities.previewSceneDefault}</option>
            {scenes.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </Select>
        )}
        {languages.length > 1 && (
          <Select
            size="sm"
            aria-label={S.activities.mediaLanguage}
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          >
            <option value="">{S.activities.previewLanguageDefault}</option>
            {languages.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        )}
        {onPick && (
          <Button size="sm" aria-pressed={picking} onClick={togglePicking}>
            {picking ? S.activities.studioPlayer.picking : S.activities.studioPlayer.pick}
          </Button>
        )}
        <a className="text-xs underline" target="_blank" rel="noopener noreferrer" href={url}>
          {S.activities.sandboxOpen}
        </a>
        <span className="flex-1" />
        <div className="w-56">
          <Select
            size="sm"
            aria-label={S.activities.previewResolutionLabel}
            value={resolution}
            onChange={(event) => setResolution(event.target.value)}
          >
            <option value="">
              {S.activities.previewResolutionOwn(`${own.width}×${own.height}`)}
            </option>
            {PREVIEW_RESOLUTIONS.filter((size) => size !== `${own.width}x${own.height}`).map(
              (size) => (
                <option key={size} value={size}>
                  {S.activities.previewResolution(size.replace("x", "×"))}
                </option>
              ),
            )}
          </Select>
        </div>
      </div>
      <div
        ref={areaRef}
        className={split ? "grid items-stretch gap-x-2" : "grid grid-cols-1"}
        style={
          split
            ? {
                gridTemplateColumns: `minmax(${PLAYER_MIN}px, 1fr) ${MAP_GUTTER - 16}px ${appliedMapWidth}px`,
                ...(stage ? { height: stageHeight } : {}),
              }
            : undefined
        }
      >
        <div ref={boxRef} className={`min-w-0 ${stage ? "flex flex-col justify-center" : ""}`}>
          <div
            className={`mx-auto max-w-full overflow-hidden border border-gray-200 bg-white dark:border-gray-800 dark:bg-black ${
              stage ? "rounded-xl shadow-lg" : "rounded-lg"
            }`}
            style={{
              height: Math.round(viewport.height * scale),
              width: Math.round(viewport.width * scale) + 2,
            }}
          >
            <iframe
              ref={frameRef}
              key={`${reloadKey}:${revision}:${url}`}
              src={url}
              title={S.activities.previewTitle}
              allow="autoplay; fullscreen"
              className="block border-0"
              style={{
                width: viewport.width,
                height: viewport.height,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
            />
          </div>
          <div ref={belowRef} className="mt-3 space-y-2">
            <PlayTimeline
              scenes={play.scenes}
              playingSceneId={view.playingSceneId}
              shownSceneId={view.sceneId}
              onRestart={() => setReloadKey((value) => value + 1)}
              onJump={playFrom}
            />
            {picked && (
              <p role="status" className="text-sm text-gray-600 dark:text-gray-300">
                {picked}
              </p>
            )}
          </div>
        </div>
        {split && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={S.activities.studioPlayer.map.resizeMap}
            title={S.activities.studioPlayer.map.resizeMap}
            aria-valuenow={appliedMapWidth}
            aria-valuemin={MAP_MIN}
            aria-valuemax={mapMaxFor(areaWidth)}
            tabIndex={0}
            onPointerDown={onDividerDown}
            onPointerMove={onDividerMove}
            onPointerUp={onDividerUp}
            onPointerCancel={() => endDrag(true)}
            onLostPointerCapture={() => endDrag(true)}
            onKeyDown={onDividerKey}
            className={`min-h-24 cursor-col-resize touch-none rounded-sm outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-500 dark:focus-visible:ring-gray-400 ${
              dragging
                ? "bg-gray-300 dark:bg-gray-600"
                : "bg-gray-100 hover:bg-gray-200 dark:bg-gray-900 dark:hover:bg-gray-700"
            }`}
          />
        )}
        <div
          className={`min-w-0 space-y-3 text-sm ${
            split
              ? stage
                ? "min-h-0 overflow-y-auto pr-1"
                : ""
              : "mt-2 border-t border-gray-200 pt-2 dark:border-gray-800"
          }`}
        >
          <PlayNow
            scene={shown}
            view={view}
            tap={tapNow(report, clock)}
            state={report?.state.state ?? null}
            status={silent ? S.activities.studioPlayer.silent : S.activities.studioPlayer.waiting}
            quiet={
              !!report &&
              silent &&
              !clock.heard &&
              play.scenes.some((entry) => entry.lines.length > 0)
            }
            onLine={play.onLine}
          />
          <StateMapView
            open={showMap}
            onToggle={toggleMap}
            language={language}
            reportedScene={report?.state.sceneId ?? null}
            reportedPhase={report?.state.phase ?? null}
            startScene={scene}
            interactables={report?.interactables ?? []}
            outlined={outlined}
            onOutline={preview}
            onPin={outline}
          />
        </div>
      </div>
    </div>
  );
}
