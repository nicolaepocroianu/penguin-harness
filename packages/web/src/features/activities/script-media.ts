/**
 * What the Activity Script can say about its media without leaving the editor: which clip a
 * line of narration or footage became, whether that clip has a file yet, and how much each
 * scene asks for.
 *
 * The media plan does not point back into the script, so a line is tied to a clip only when
 * their words are the same, ignoring case, punctuation and spacing: the narration's text
 * against an audio clip's script, a picture's or a video's text against its description. A
 * line that matches nothing says nothing, rather than guessing; a line that matches says
 * exactly what the plan holds.
 */
import type { AssetManifest } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import type { SceneAssetTree } from "./scene-assets";
import { mediaElementSpans, type MediaElement, type ScriptScene } from "./script-model";
import { scriptSceneFor } from "./studio-tree";

type MediaAsset = AssetManifest["assets"][string][number];

export interface ScriptClip {
  key: string;
  /** A file is bound to it, by a generation run or by an author. */
  bound: boolean;
  /** The bound clip's length, when the plan knows it. */
  durationMs?: number;
}

export interface SceneMedia {
  /** Narration, music and sound the scene asks for. */
  heard: number;
  /** Pictures, video and animation. */
  seen: number;
  /** Media still without a file. */
  unbound: number;
}

export interface ScriptMedia {
  /** The clip a written element became, or null when no clip has its words. */
  clipFor(element: MediaElement, text: string): ScriptClip | null;
  /** A scene's media, by its number in the script; null for a scene the plan does not name. */
  scene(number: number): SceneMedia | null;
  /** Every clip the plan holds for the language shown, and how many have files. */
  totals: { bound: number; total: number };
}

/** Words only: lower case, letters and digits, single spaces. */
export function normalizeWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The words between an element's opening and closing tags. */
export function elementText(raw: string): string {
  return raw.replace(/^<[^<>]*>/, "").replace(/<[^<>]*>$/, "");
}

/** Which of a clip's texts a written element is compared with. */
function matchText(asset: MediaAsset): string | undefined {
  return asset.type === "audio" ? asset.script : asset.description;
}

export function buildScriptMedia(
  assets: readonly MediaAsset[],
  tree: SceneAssetTree,
  scenes: readonly ScriptScene[],
): ScriptMedia {
  const byText = new Map<string, ScriptClip>();
  for (const asset of assets) {
    const words = normalizeWords(matchText(asset) ?? "");
    if (!words) continue;
    const id = `${asset.type}:${words}`;
    const clip: ScriptClip = {
      key: asset.key,
      bound: !!asset.path,
      ...(asset.durationMs !== undefined ? { durationMs: asset.durationMs } : {}),
    };
    // Two clips with the same words: a bound one says more about the line than an empty one.
    const known = byText.get(id);
    if (!known || (!known.bound && clip.bound)) byText.set(id, clip);
  }

  const byScene = new Map<number, SceneMedia>();
  for (const node of tree.scenes) {
    const named = scriptSceneFor(node.sceneId, scenes);
    if (!named) continue;
    const media: SceneMedia = { heard: 0, seen: 0, unbound: 0 };
    for (const category of node.categories)
      for (const leaf of category.assets) {
        if (leaf.bookWord) continue;
        if (leaf.type === "audio") media.heard += 1;
        else media.seen += 1;
        if (!leaf.bound) media.unbound += 1;
      }
    byScene.set(named.number, media);
  }

  return {
    clipFor: (element, text) => byText.get(`${element}:${normalizeWords(text)}`) ?? null,
    scene: (number) => byScene.get(number) ?? null,
    totals: {
      total: assets.filter((asset) => !asset.role).length,
      bound: assets.filter((asset) => !asset.role && !!asset.path).length,
    },
  };
}

/** Roughly how long the narration takes to say, at a young listener's pace. */
const WORDS_PER_MINUTE = 130;

export interface ScriptFigures {
  words: number;
  /** Seconds of narration, from the words inside audio elements. */
  narrationSeconds: number;
}

export function scriptFigures(text: string): ScriptFigures {
  const words = (text.replace(/<[^<>]*>/g, " ").match(/[\p{L}\p{N}']+/gu) ?? []).length;
  let spoken = 0;
  for (const line of text.split("\n"))
    for (const span of mediaElementSpans(line))
      if (span.element === "audio")
        spoken += (elementText(line.slice(span.from, span.to)).match(/[\p{L}\p{N}']+/gu) ?? [])
          .length;
  return { words, narrationSeconds: Math.round((spoken / WORDS_PER_MINUTE) * 60) };
}

/** A clip's length for a chip: "1.8 s", or "1 min 05 s" once it passes a minute. */
export function formatClipLength(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return S.activities.studioScript.seconds(seconds.toFixed(1));
  const whole = Math.round(seconds);
  return S.activities.studioScript.minutes(
    Math.floor(whole / 60),
    String(whole % 60).padStart(2, "0"),
  );
}

/**
 * Where a clip's chip opens it in Scenes: under the first scene that asks for it, or, for a
 * clip no scene asks for, among the unassigned media, which the tree keys by an empty scene.
 */
export function clipSelection(
  tree: SceneAssetTree,
  key: string,
): { sceneId: string; key: string } | null {
  const scene = tree.scenes.find((node) =>
    node.categories.some((category) => category.assets.some((asset) => asset.key === key)),
  );
  if (scene) return { sceneId: scene.sceneId, key };
  if (tree.unassigned.some((asset) => asset.key === key)) return { sceneId: "", key };
  return null;
}
