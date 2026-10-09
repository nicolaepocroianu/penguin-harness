/**
 * The Activity Spec read as scenes: the runtime facts as chips, the description, the
 * acceptance criteria, and one card per scene with its narration checked against the
 * Activity Script and its media with whether a file is bound yet. It shows the editor's
 * text, unsaved edits included, and its two fixes (removing a setting written into the
 * description, taking the script's wording for a narration line) are ordinary edits of
 * that text: Diff shows them and Save Spec saves them. Everything else is edited in JSON.
 */
import { useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { Chevron } from "../../components/ui/chevron";
import { InfoPopover } from "../../components/ui/info-popover";
import { ICON_SIZE } from "../../lib/icon-scale";
import { S } from "../../lib/strings";
import { toneDot, toneInk, toneStrip, type Tone } from "../../lib/tone";
import { sceneRanges } from "./script-model";
import {
  checkNarration,
  readSpec,
  sceneAgrees,
  stripDescriptionPrefix,
  takeScriptLine,
  type SceneCheck,
  type SpecMediaKind,
  type SpecSceneReading,
} from "./spec-scenes";

export type SpecView = "scenes" | "json";

const VIEW_KEY = "penguin.activitySpec.view";

/** The view this viewer last chose, or null before a choice. */
export function readSpecView(): SpecView | null {
  try {
    const stored = localStorage.getItem(VIEW_KEY);
    return stored === "scenes" || stored === "json" ? stored : null;
  } catch {
    // Private windows and blocked site data throw rather than return null.
    return null;
  }
}

export function writeSpecView(view: SpecView) {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // A remembered view is a convenience; losing it is not worth failing the toggle.
  }
}

const CHIP =
  "inline-flex items-center rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-700 dark:border-gray-800 dark:text-gray-300";
const HEADING = "flex items-center gap-2 text-sm font-semibold";
const COUNT = "font-normal text-gray-500 dark:text-gray-400";
const LABEL = "text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400";

/** The dot-and-text mark a scene's check shows, named in text so colour is never alone. */
function StateMark({ tone, text }: { tone: Tone; text: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${toneInk[tone]}`}>
      <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${toneDot[tone]}`} />
      {text}
    </span>
  );
}

function sceneState(check: SceneCheck): { tone: Tone; text: string } {
  const words = S.activities.specScenes;
  if (!check.known) return { tone: "muted", text: words.notInScript };
  if (sceneAgrees(check)) return { tone: "success", text: words.matches };
  return { tone: "attention", text: words.differs(check.differing + check.extraInScript) };
}

function sceneCounts(scene: SpecSceneReading): string {
  const words = S.activities.specScenes;
  const say: [SpecMediaKind, (n: number) => string][] = [
    ["video", words.videos],
    ["image", words.images],
    ["animation", words.animations],
    ["sound", words.sounds],
  ];
  const parts: string[] = [];
  for (const [kind, phrase] of say) {
    const n = scene.media.filter((item) => item.kind === kind).length;
    if (n > 0) parts.push(phrase(n));
  }
  parts.push(
    scene.narration.length ? words.narrationLines(scene.narration.length) : words.noNarration,
  );
  return parts.join(" · ");
}

function SceneCard({
  scene,
  check,
  open,
  bindings,
  editable,
  onToggle,
  onUseScript,
}: {
  scene: SpecSceneReading;
  check: SceneCheck;
  open: boolean;
  bindings: ReadonlyMap<string, boolean> | null;
  editable: boolean;
  onToggle: () => void;
  onUseScript: (key: string, script: string) => void;
}) {
  const words = S.activities.specScenes;
  const state = sceneState(check);
  const body = `spec-scene-${scene.number}`;
  return (
    <article
      aria-label={words.scene(scene.number, scene.title)}
      className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800"
    >
      <div className="flex items-center gap-2 bg-gray-50 px-3 py-2 dark:bg-gray-900">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={body}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Chevron open={open} size={ICON_SIZE.chevron} className="text-gray-400" />
          <span className="w-5 shrink-0 text-xs text-gray-500 tabular-nums dark:text-gray-400">
            {scene.number}
          </span>
          <span className="min-w-0 truncate text-sm font-semibold">{scene.title}</span>
          <span className="hidden min-w-0 truncate text-xs text-gray-500 sm:inline dark:text-gray-400">
            {sceneCounts(scene)}
          </span>
        </button>
        <StateMark tone={state.tone} text={state.text} />
      </div>
      <div
        id={body}
        className={`${open ? "grid" : "hidden"} gap-4 border-t border-gray-200 p-3 md:grid-cols-2 dark:border-gray-800`}
      >
        <div className="min-w-0 space-y-2">
          <div className={LABEL}>{words.narration}</div>
          {check.lines.length === 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400">{words.noNarration}</p>
          )}
          {check.lines.map((line) => {
            const differs = check.known && !line.matches;
            return (
              <div
                key={line.key}
                className={`flex items-start gap-2 rounded-md text-sm ${differs ? `-mx-1.5 p-1.5 ${toneStrip.attention}` : ""}`}
              >
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block font-mono text-xs text-gray-500 dark:text-gray-400">
                    {line.key}
                  </span>
                  <span className="block leading-snug">“{line.script}”</span>
                  {differs && (
                    <span className="block text-xs">
                      {line.scriptSays === null
                        ? words.lineNotInScript
                        : words.scriptSays(line.scriptSays)}
                    </span>
                  )}
                </span>
                {differs && editable && line.scriptSays !== null && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onUseScript(line.key, line.scriptSays!)}
                  >
                    {words.useScript}
                  </Button>
                )}
              </div>
            );
          })}
          {check.extraInScript > 0 && (
            <p className={`text-xs ${toneInk.attention}`}>
              {words.extraInScript(check.extraInScript)}
            </p>
          )}
        </div>
        <div className="min-w-0 space-y-2">
          <div className={LABEL}>{words.media}</div>
          {scene.media.length === 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400">—</p>
          )}
          {scene.media.map((item) => {
            const bound = bindings?.get(item.key);
            return (
              <div
                key={`${item.kind}:${item.key}`}
                className="flex items-center gap-2 rounded-md border border-gray-200 p-2 dark:border-gray-800"
              >
                <span className={`${CHIP} shrink-0`}>{words.kinds[item.kind]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs">{item.key}</span>
                  {item.description && (
                    <span className="block text-xs text-gray-500 dark:text-gray-400">
                      {item.description}
                    </span>
                  )}
                </span>
                {bound !== undefined && (
                  <StateMark
                    tone={bound ? "success" : "attention"}
                    text={bound ? words.bound : words.needsFile}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </article>
  );
}

export function SpecScenesView({
  text,
  script,
  bindings,
  editable,
  onChange,
  onOpenJson,
}: {
  /** The editor's text, as it stands. */
  text: string;
  /** The Activity Script as it stands, whose scenes the narration is checked against. */
  script: string;
  /** Whether each media key has a file, by key; null before there is a media plan. */
  bindings: ReadonlyMap<string, boolean> | null;
  editable: boolean;
  onChange: (text: string) => void;
  onOpenJson: () => void;
}) {
  const words = S.activities.specScenes;
  const scriptScenes = useMemo(() => sceneRanges(script), [script]);
  const reading = useMemo(() => readSpec(text, scriptScenes), [text, scriptScenes]);
  const checks = useMemo(
    () =>
      reading ? reading.scenes.map((scene) => checkNarration(scene, script, scriptScenes)) : [],
    [reading, script, scriptScenes],
  );
  // A scene the author has not touched opens when it differs, so the work shows itself.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  if (!reading)
    return (
      <div className="m-4 flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
        <span className="flex-1">{words.unreadable}</span>
        <Button size="sm" variant="secondary" onClick={onOpenJson}>
          {words.openJson}
        </Button>
      </div>
    );

  const known = checks.filter((check) => check.known);
  const matching = known.filter(sceneAgrees).length;
  const runtime = reading.runtime;
  const chips: string[] = runtime
    ? [
        ...(runtime.engine !== undefined ? [words.engine(runtime.engine)] : []),
        ...(runtime.layout !== undefined ? [words.layout(runtime.layout)] : []),
        ...(runtime.theme !== undefined ? [words.theme(runtime.theme)] : []),
        ...(runtime.resolution !== undefined ? [runtime.resolution] : []),
        ...(runtime.usesAssessment !== undefined ? [words.assessment(runtime.usesAssessment)] : []),
      ]
    : [];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4">
      {chips.length > 0 && (
        <section className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-gray-500 dark:text-gray-400">{words.runtime}</span>
          {chips.map((chip) => (
            <span key={chip} className={CHIP}>
              {chip}
            </span>
          ))}
        </section>
      )}
      <section className="space-y-1.5">
        <h3 className={HEADING}>{words.description}</h3>
        {reading.description.trim() ? (
          <p className="text-sm leading-relaxed whitespace-pre-line text-gray-700 dark:text-gray-300">
            {reading.description.trim()}
          </p>
        ) : (
          <p className="text-xs text-gray-500 dark:text-gray-400">{words.noDescription}</p>
        )}
        {reading.descriptionPrefix !== null && (
          <div
            role="status"
            className={`flex flex-wrap items-center gap-2 rounded-md border px-3 py-1.5 text-xs ${toneStrip.attention}`}
          >
            <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${toneDot.attention}`} />
            <span className="flex-1">{words.prefixNotice(reading.descriptionPrefix)}</span>
            {editable && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const next = stripDescriptionPrefix(text);
                  if (next !== null) onChange(next);
                }}
              >
                {words.removePrefix}
              </Button>
            )}
          </div>
        )}
      </section>
      <section className="space-y-1.5">
        <h3 className={HEADING}>
          {words.criteria}
          <span className={COUNT}>{reading.criteria.length}</span>
        </h3>
        {reading.criteria.length ? (
          <ol className="list-decimal space-y-1 pl-5 text-sm text-gray-700 dark:text-gray-300">
            {reading.criteria.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ol>
        ) : (
          <p className="rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
            {words.noCriteria}
          </p>
        )}
      </section>
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className={HEADING}>
            {words.scenes}
            <span className={COUNT}>{reading.scenes.length}</span>
            <InfoPopover label={words.scenes}>
              <p>{words.scenesHelp}</p>
            </InfoPopover>
          </h3>
          <span className="flex-1" />
          {known.length > 0 && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {words.summary(matching, known.length - matching)}
            </span>
          )}
        </div>
        {reading.scenes.length === 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400">{words.noScenes}</p>
        )}
        {reading.scenes.map((scene, index) => {
          const check = checks[index]!;
          const open = toggled[scene.id] ?? (check.known && !sceneAgrees(check));
          return (
            <SceneCard
              key={`${scene.number}:${scene.id}`}
              scene={scene}
              check={check}
              open={open}
              bindings={bindings}
              editable={editable}
              onToggle={() => setToggled((current) => ({ ...current, [scene.id]: !open }))}
              onUseScript={(key, line) => {
                const next = takeScriptLine(text, scene.id, key, line);
                if (next !== null) onChange(next);
              }}
            />
          );
        })}
      </section>
    </div>
  );
}
