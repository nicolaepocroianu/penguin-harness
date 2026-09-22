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
}: {
  projectId: string;
  activityId: string;
  spec: Record<string, unknown> | null;
  languages: string[];
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
}: {
  projectId: string;
  activityId: string;
  spec: Record<string, unknown> | null;
  languages: string[];
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
        </div>
      )}
    </div>
  );
}
