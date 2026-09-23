import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SandboxBuildReport, SandboxStatus } from "@prismshadow/penguin-server/api";
import { apiFetch } from "../../api/client";
import { S } from "../../lib/strings";
import { toneStrip } from "../../lib/tone";
import { Button } from "../../components/ui/button";
import { InfoPopover } from "../../components/ui/info-popover";
import { Select } from "../../components/ui/select";
import { fitScale, parseResolution, sceneIds } from "./preview";
import { canBuild, playUrl, sandboxTone } from "./sandbox";
import {
  highlightMessage,
  pickModeMessage,
  readPlayerPick,
  readPlayerReport,
  type PlayerPick,
  type PlayerReport,
} from "./player-bridge";

/**
 * Opens what an author picked in the player, answering the name of what it opened, or null
 * when nothing in the activity is named the way the picked element is.
 */
export type OnPick = (pick: PlayerPick, sceneId: string | null) => string | null;

/**
 * What the harness knows about this activity's module, and the one action an author has.
 *
 * Separate from `ModulePreview`, which runs the bundle an assembly agent produced. This
 * reports the harness's own build of the same module and lets an author rebuild it, so a
 * failed build is something they can see and act on rather than a preview that never
 * appears -- and plays it, including a module Loom left in the WAF checkout.
 */
export function SandboxPanel({
  projectId,
  activityId,
  spec,
  languages,
  onPick,
}: {
  projectId: string;
  activityId: string;
  spec: Record<string, unknown> | null;
  languages: string[];
  onPick?: OnPick;
}) {
  const base = `/api/projects/${encodeURIComponent(projectId)}/activities/${encodeURIComponent(activityId)}/sandbox`;
  const [status, setStatus] = useState<SandboxStatus | null>(null);
  const [report, setReport] = useState<SandboxBuildReport | null>(null);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await apiFetch<SandboxStatus>(`${base}/status`));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [base]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const build = async () => {
    setBuilding(true);
    setError(null);
    try {
      // Forced: an author pressing Build after a build they believe failed is asking for a
      // build, not a freshness opinion.
      setReport(
        await apiFetch<SandboxBuildReport>(`${base}/build`, {
          method: "POST",
          body: { force: true },
        }),
      );
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBuilding(false);
    }
  };

  if (!status && !error) return null;
  // The last build's output, whichever call produced it. A failed build is only readable in
  // full, so it is shown rather than summarised.
  const log = report?.ok === false ? report.log : (status?.buildLog ?? null);

  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {S.activities.sandboxTitle}
        <InfoPopover label={S.activities.sandboxTitle}>
          <p>{S.activities.sandboxHelp}</p>
        </InfoPopover>
      </h3>
      {status && (
        <p
          role="status"
          className={`rounded-md border p-3 text-xs ${toneStrip[sandboxTone(status)]}`}
        >
          {status.message}
        </p>
      )}
      {report && (
        <p
          role="status"
          className={`rounded-md border p-3 text-xs ${toneStrip[report.ok ? "success" : "danger"]}`}
        >
          {report.message}
        </p>
      )}
      {error && (
        <p role="alert" className={`rounded-md border p-3 text-xs ${toneStrip.danger}`}>
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => void build()}
          disabled={building || !status || !canBuild(status)}
        >
          {building ? S.activities.sandboxBuilding : S.activities.sandboxBuild}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={building}>
          {S.activities.sandboxRefresh}
        </Button>
      </div>
      {status?.playable && (
        <SandboxPlayer
          projectId={projectId}
          activityId={activityId}
          spec={spec}
          languages={languages}
          onPick={onPick}
        />
      )}
      {log && (
        <details>
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
 * The activity, playing. Nothing loads until an author presses Play: the first play of a
 * module builds it, and a panel that built on sight would build every module anyone opened.
 */
function SandboxPlayer({
  projectId,
  activityId,
  spec,
  languages,
  onPick,
}: {
  projectId: string;
  activityId: string;
  spec: Record<string, unknown> | null;
  languages: string[];
  onPick?: OnPick;
}) {
  const viewport = parseResolution(
    (spec?.runtime as Record<string, unknown> | undefined)?.resolution,
  );
  const scenes = sceneIds(spec);
  const [playing, setPlaying] = useState(false);
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
  const sceneRef = useRef<string | null>(null);
  sceneRef.current = report?.state.sceneId ?? null;
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  useEffect(() => {
    if (!playing) return;
    const receive = (event: MessageEvent) => {
      const frame = frameRef.current?.contentWindow;
      const next = readPlayerReport(event.data, event.source, frame);
      if (next) {
        setReport(next);
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
          : S.activities.studioPlayer.noMatch(pick.id ?? pick.interactableId ?? ""),
      );
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [playing]);
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
    setOutlined(null);
    setPicking(false);
    setPicked(null);
  }, [playing, reloadKey, scene, language]);
  function outline(id: string) {
    const next = outlined === id ? null : id;
    setOutlined(next);
    // The page may sit on the preview origin or, sandboxed, on no origin at all, so there
    // is no origin to name. The message is an id and nothing else; the page accepts it
    // only from this window.
    frameRef.current?.contentWindow?.postMessage(highlightMessage(next), "*");
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
  }, [playing]);
  const scale = fitScale(viewport, { width: boxWidth, height: viewport.height });
  const url = playUrl(projectId, activityId, {
    scene: scene || undefined,
    language: language || undefined,
  });
  return (
    <div className="space-y-3">
      <h4 className="flex items-center gap-2 text-sm font-semibold">
        {S.activities.sandboxPlayer}
        <InfoPopover label={S.activities.sandboxPlayer}>
          <p>{S.activities.sandboxPlayHelp}</p>
        </InfoPopover>
      </h4>
      <div className="flex flex-wrap items-center gap-2">
        {scenes.length > 0 && (
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
        {playing ? (
          <>
            {onPick && (
              <Button size="sm" aria-pressed={picking} onClick={togglePicking}>
                {picking ? S.activities.studioPlayer.picking : S.activities.studioPlayer.pick}
              </Button>
            )}
            <Button size="sm" onClick={() => setReloadKey((value) => value + 1)}>
              {S.activities.previewReload}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPlaying(false)}>
              {S.activities.sandboxStop}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="primary" onClick={() => setPlaying(true)}>
            {S.activities.sandboxPlay}
          </Button>
        )}
        <a className="text-xs underline" target="_blank" rel="noopener noreferrer" href={url}>
          {S.activities.sandboxOpen}
        </a>
        <span className="text-xs text-gray-500">
          {S.activities.previewResolution(`${viewport.width}×${viewport.height}`)}
        </span>
      </div>
      {playing && (
        <div ref={boxRef} className="w-full">
          <div
            className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-black"
            style={{ height: Math.round(viewport.height * scale) }}
          >
            <iframe
              ref={frameRef}
              key={`${reloadKey}:${url}`}
              src={url}
              title={S.activities.sandboxPlayer}
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
          <div className="mt-3 space-y-2 text-sm">
            {picked && (
              <p role="status" className="text-gray-600 dark:text-gray-300">
                {picked}
              </p>
            )}
            <p aria-live="polite" className="text-gray-600 dark:text-gray-300">
              {report
                ? S.activities.studioPlayer.now(report.state.state, report.state.sceneId)
                : S.activities.studioPlayer.waiting}
            </p>
            {report && report.interactables.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-gray-500">
                  {S.activities.studioPlayer.tapTargets}
                </span>
                {report.interactables.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    aria-pressed={outlined === entry.id}
                    title={entry.description ?? entry.id}
                    onClick={() => outline(entry.id)}
                    className={`rounded-md border px-2 py-0.5 text-xs ${
                      outlined === entry.id
                        ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-200"
                        : "border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                    }`}
                  >
                    {entry.id}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
