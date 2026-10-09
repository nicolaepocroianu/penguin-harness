/**
 * The Activity Spec as an author reads it: the runtime facts, the description, the
 * acceptance criteria, and one entry per scene with its narration lines and media items.
 * Everything here reads the editor's JSON text, so the view shows the draft as it stands,
 * unsaved edits included, and never a copy of the saved document.
 *
 * A scene's narration is checked against the Activity Script by the same rule the script's
 * clip chips use: two lines are the same when their words are, ignoring case, punctuation
 * and spacing. A spec line whose words no script line in that scene has differs; it is then
 * paired, in order, with a script line no spec line has, so "Use the script" has exactly one
 * text to offer. A line left without a pair says so rather than guessing.
 *
 * The fixes rewrite the parsed document and print it the way the editor prints a loaded
 * one, so a fix made here reads as the one changed line in Diff rather than a reformat.
 */
import { mediaElementSpans, type ScriptScene } from "./script-model";
import { elementText, normalizeWords } from "./script-media";
import { scriptSceneFor } from "./studio-tree";

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** What the validated specification's runtime names; each absent when the draft lacks it. */
export interface SpecRuntime {
  engine?: string;
  layout?: string;
  theme?: string;
  resolution?: string;
  usesAssessment?: boolean;
}

export type SpecMediaKind = "image" | "video" | "animation" | "sound";

export interface SpecMediaItem {
  key: string;
  kind: SpecMediaKind;
  description: string;
}

export interface SpecNarration {
  key: string;
  script: string;
}

export interface SpecSceneReading {
  /** 1-based, in the specification's order. */
  number: number;
  id: string;
  /** The script's name for the scene, else the description's first line, else the id. */
  title: string;
  /** Audio tracks with a script: what the module says. */
  narration: SpecNarration[];
  /** Pictures, footage, animation, and audio tracks without a script. */
  media: SpecMediaItem[];
}

export interface SpecReading {
  runtime: SpecRuntime | null;
  description: string;
  /** A `usesAssessment=…` setting written at the head of the description, verbatim. */
  descriptionPrefix: string | null;
  criteria: string[];
  scenes: SpecSceneReading[];
}

/** A setting an agent wrote into the prose, where the module never reads it. */
const DESCRIPTION_PREFIX = /^\s*(usesAssessment\s*=\s*[^\s]+)\s*/i;

function parseObject(text: string): Json | null {
  try {
    const value: unknown = JSON.parse(text);
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

function scenesOf(spec: Json): Json[] {
  const scenes = spec.scenes ?? spec.stages;
  return Array.isArray(scenes)
    ? scenes.filter((scene): scene is Json => isObject(scene) && typeof scene.id === "string")
    : [];
}

function assetList(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

function items(list: unknown, kind: SpecMediaKind): SpecMediaItem[] {
  return assetList(list)
    .filter((asset) => typeof asset.key === "string")
    .map((asset) => ({ key: asset.key as string, kind, description: text(asset.description) }));
}

function readScene(scene: Json, number: number, script: readonly ScriptScene[]): SpecSceneReading {
  const id = scene.id as string;
  const description = text(scene.description);
  const media = isObject(scene.media) ? scene.media : {};
  const tracks = assetList(isObject(scene.audio) ? scene.audio.tracks : undefined).filter(
    (track) => typeof track.key === "string",
  );
  const spoken = tracks.filter((track) => typeof track.script === "string" && track.script.trim());
  const silent = tracks.filter((track) => !spoken.includes(track));
  return {
    number,
    id,
    title: scriptSceneFor(id, script)?.title || description.split("\n")[0]!.trim() || id,
    narration: spoken.map((track) => ({
      key: track.key as string,
      script: track.script as string,
    })),
    media: [
      ...items(media.images, "image"),
      ...items(media.video, "video"),
      ...items(media.animations, "animation"),
      ...silent.map((track) => ({
        key: track.key as string,
        kind: "sound" as const,
        description: text(track.description),
      })),
    ],
  };
}

/** The draft as scenes, or null when the text is not a JSON object with scenes to show. */
export function readSpec(draft: string, script: readonly ScriptScene[]): SpecReading | null {
  const spec = parseObject(draft);
  if (!spec) return null;
  const runtime = isObject(spec.runtime) ? spec.runtime : null;
  const description = text(spec.activityDescription);
  const prefix = DESCRIPTION_PREFIX.exec(description);
  const criteria = Array.isArray(spec.acceptance_criterias)
    ? spec.acceptance_criterias.filter((item): item is string => typeof item === "string")
    : [];
  return {
    runtime: runtime
      ? {
          ...(typeof runtime.engine === "string" ? { engine: runtime.engine } : {}),
          ...(typeof runtime.layout === "string" ? { layout: runtime.layout } : {}),
          ...(typeof runtime.theme === "string" ? { theme: runtime.theme } : {}),
          ...(typeof runtime.resolution === "string" ? { resolution: runtime.resolution } : {}),
          ...(typeof runtime.usesAssessment === "boolean"
            ? { usesAssessment: runtime.usesAssessment }
            : {}),
        }
      : null,
    description: prefix ? description.slice(prefix[0].length) : description,
    descriptionPrefix: prefix ? prefix[1]! : null,
    criteria,
    scenes: scenesOf(spec).map((scene, index) => readScene(scene, index + 1, script)),
  };
}

export interface NarrationCheck extends SpecNarration {
  /** The words are a script line's in this scene. */
  matches: boolean;
  /** For a line that differs: the script line it stands for, or null when the script has none spare. */
  scriptSays: string | null;
}

export interface SceneCheck {
  /** The script has a scene with this number; without one there is nothing to compare. */
  known: boolean;
  lines: NarrationCheck[];
  /** Spec lines whose words no script line has. */
  differing: number;
  /** Script lines left over once every differing spec line has its pair. */
  extraInScript: number;
}

/** The `<audio>` texts written in the script's scene, in order. */
export function scriptNarration(scriptText: string, scene: ScriptScene): string[] {
  const lines = scriptText.replace(/\r\n/g, "\n").split("\n");
  const spoken: string[] = [];
  for (const line of lines.slice(scene.heading, scene.last))
    for (const span of mediaElementSpans(line))
      if (span.element === "audio") spoken.push(elementText(line.slice(span.from, span.to)).trim());
  return spoken;
}

export function checkNarration(
  scene: SpecSceneReading,
  scriptText: string,
  script: readonly ScriptScene[],
): SceneCheck {
  const named = scriptSceneFor(scene.id, script);
  if (!named)
    return {
      known: false,
      lines: scene.narration.map((line) => ({ ...line, matches: false, scriptSays: null })),
      differing: 0,
      extraInScript: 0,
    };
  // Each script line answers for one spec line, so a repeated line needs repeating.
  const spare = scriptNarration(scriptText, named).map((text) => ({
    text,
    words: normalizeWords(text),
    taken: false,
  }));
  const lines: NarrationCheck[] = scene.narration.map((line) => {
    const words = normalizeWords(line.script);
    const found = spare.find((entry) => !entry.taken && entry.words === words);
    if (found) found.taken = true;
    return { ...line, matches: !!found, scriptSays: null };
  });
  const unmatched = spare.filter((entry) => !entry.taken);
  let differing = 0;
  for (const line of lines) {
    if (line.matches) continue;
    differing += 1;
    const pair = unmatched.shift();
    line.scriptSays = pair?.text ?? null;
  }
  return { known: true, lines, differing, extraInScript: unmatched.length };
}

/** Whether a checked scene and the script agree on every narration line. */
export const sceneAgrees = (check: SceneCheck): boolean =>
  check.known && check.differing === 0 && check.extraInScript === 0;

/**
 * The draft with `edit` applied to its parsed document, printed as the editor prints a
 * loaded document; null when the text does not parse or the edit found nothing to change.
 */
export function editSpec(draft: string, edit: (spec: Json) => boolean): string | null {
  const spec = parseObject(draft);
  if (!spec || !edit(spec)) return null;
  return JSON.stringify(spec, null, 2);
}

/** The description without the setting written at its head. */
export function stripDescriptionPrefix(draft: string): string | null {
  return editSpec(draft, (spec) => {
    const description = text(spec.activityDescription);
    const prefix = DESCRIPTION_PREFIX.exec(description);
    if (!prefix) return false;
    spec.activityDescription = description.slice(prefix[0].length);
    return true;
  });
}

/** The scene's track with `key` saying `script` instead. */
export function takeScriptLine(
  draft: string,
  sceneId: string,
  key: string,
  script: string,
): string | null {
  return editSpec(draft, (spec) => {
    const scene = scenesOf(spec).find((item) => item.id === sceneId);
    const track = assetList(isObject(scene?.audio) ? scene.audio.tracks : undefined).find(
      (item) => item.key === key,
    );
    if (!track || track.script === script) return false;
    track.script = script;
    return true;
  });
}
