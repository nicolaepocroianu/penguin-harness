/**
 * Play mode's model: the activity's scenes as the player walks them, the line being spoken,
 * and what can be tapped now, all worked out from what the player bridge reports
 * (player-bridge.ts) and the plan's word timings. Nothing here is stored: the clock below
 * lives as long as one run of the activity in the preview.
 *
 * A scene's lines are its narration in the script's order (narration-scenes.ts). The bridge
 * says which scene the activity is in, and which clip it starts and ends by the clip's asset
 * key; the line lit is the narration clip sounding now, and its word is the one the clip's
 * timings place at the time since it started. An author may light a line too, by choosing it
 * in the Script or in the player's list; whichever happened last is the one lit.
 */
import type { MediaAsset } from "@prismshadow/penguin-server/api";
import type { MediaPreview } from "./media-preview";
import { narrationScenes } from "./narration-scenes";
import type { PlayerInteractable, PlayerMedia, PlayerReport } from "./player-bridge";
import type { SceneAssetTree } from "./scene-assets";
import type { ScriptScene } from "./script-model";
import { activeWord } from "./speech-provider";
import { scriptSceneFor } from "./studio-tree";

export interface WordTiming {
  word: string;
  startMs: number;
  endMs: number;
}

export interface PlayLine {
  key: string;
  /** What the line says: its narration script. */
  words: string;
  /** How long it takes to say, from its clip when the plan knows it, else from its words. */
  durationMs: number;
  /** The length is a guess from the number of words, not the clip's. */
  estimated: boolean;
  timings: readonly WordTiming[] | null;
  /** Where its clip plays from, for its waveform; null while it has no file. */
  src: string | null;
}

export interface PlayScene {
  sceneId: string;
  /** 1-based, among the scenes the player walks. */
  number: number;
  /** The script's title for the scene, or null when the script names no such scene. */
  title: string | null;
  lines: PlayLine[];
  /** Every line's length together: what sizes the scene on the timeline. */
  durationMs: number;
  /** The scene's picture, as the storyboard shows it. */
  preview: MediaPreview;
}

/** A young listener's pace, as the script's own narration estimate uses. */
const WORDS_PER_MINUTE = 130;

function lineLength(asset: MediaAsset): { durationMs: number; estimated: boolean } {
  if (asset.durationMs !== undefined && asset.durationMs > 0)
    return { durationMs: asset.durationMs, estimated: false };
  const last = asset.wordTimings?.at(-1)?.endMs;
  if (last !== undefined && last > 0) return { durationMs: last, estimated: false };
  const words = (asset.script ?? "").match(/[\p{L}\p{N}']+/gu)?.length ?? 0;
  return { durationMs: Math.round((words / WORDS_PER_MINUTE) * 60_000), estimated: true };
}

/** Narration, rather than music, a sound effect or a book word's recording. */
function isNarration(asset: MediaAsset): boolean {
  return asset.type === "audio" && !asset.kind && !asset.role;
}

/**
 * The scenes the player walks, in the specification's order, each with its narration in the
 * script's order. Shared media (a general scene) is not a step of the activity, so it is
 * left out. A line several scenes say is listed under each of them.
 */
export function playScenes({
  tree,
  script,
  assets,
  sourceOf,
  previewOf,
}: {
  tree: SceneAssetTree;
  script: { text: string; scenes: readonly ScriptScene[] };
  /** The shown language's group of the media plan. */
  assets: readonly MediaAsset[];
  sourceOf: (asset: MediaAsset) => string | null;
  /** A scene's picture, by the scene's id. */
  previewOf: (sceneId: string) => MediaPreview;
}): PlayScene[] {
  const byKey = new Map(assets.map((asset) => [asset.key, asset]));
  const rows = assets.filter(isNarration).map((asset) => ({
    key: asset.key,
    sceneIds: [...new Set(asset.usages.map((usage) => usage.sceneId))],
  }));
  const groups = narrationScenes(rows, tree, script, (key) => byKey.get(key)?.script, {
    every: true,
  });
  return tree.scenes
    .filter((scene) => !scene.general)
    .map((scene, index) => {
      const group = groups.find((entry) => entry.sceneId === scene.sceneId);
      const lines = (group?.rows ?? []).map((row): PlayLine => {
        const asset = byKey.get(row.key)!;
        return {
          key: asset.key,
          words: asset.script?.trim() ?? "",
          ...lineLength(asset),
          timings: asset.wordTimings?.length ? asset.wordTimings : null,
          src: sourceOf(asset),
        };
      });
      return {
        sceneId: scene.sceneId,
        number: index + 1,
        title: scriptSceneFor(scene.sceneId, script.scenes)?.title ?? null,
        lines,
        durationMs: lines.reduce((total, line) => total + line.durationMs, 0),
        preview: previewOf(scene.sceneId),
      };
    });
}

/** A clip the activity is playing, and when it started on the page's clock. */
export interface Sounding {
  key: string;
  at: number;
}

/** What one run of the activity has said so far, kept while it plays. */
export interface PlayClock {
  /** The scene it last reported, and when it entered it. */
  scene: { id: string; at: number } | null;
  audio: Sounding | null;
  video: Sounding | null;
  /** Whether the module has said anything about its media; older modules never do. */
  heard: boolean;
}

export const IDLE_CLOCK: PlayClock = { scene: null, audio: null, video: null, heard: false };

/** The clock after a state report: a new scene starts its own time; the same one keeps it. */
export function clockAfterReport(clock: PlayClock, report: PlayerReport, at: number): PlayClock {
  if (clock.scene?.id === report.state.sceneId) return clock;
  return { ...clock, scene: { id: report.state.sceneId, at } };
}

/** What ends a clip, whichever way it ended. */
const ENDED = new Set(["completed", "interrupted", "failed", "unavailable", "stopped"]);

/** The clock after a clip started or ended; kinds other than sound and video only count as heard. */
export function clockAfterMedia(clock: PlayClock, media: PlayerMedia, at: number): PlayClock {
  const heard = { ...clock, heard: true };
  if (media.kind !== "audio" && media.kind !== "video") return heard;
  const slot = media.kind;
  if (media.status === "started") return { ...heard, [slot]: { key: media.key, at } };
  if (ENDED.has(media.status) && clock[slot]?.key === media.key) return { ...heard, [slot]: null };
  return heard;
}

/** A line an author chose, and when. */
export interface LinePick {
  key: string;
  at: number;
}

export interface LitLine {
  key: string;
  sceneId: string;
  /** The player is saying it, or an author chose it. */
  by: "player" | "author";
  /** The word being said, as an index into its timings; -1 between words or without them. */
  word: number;
  /** How far through the line the player is, 0 to 1; 0 for a line an author chose. */
  progress: number;
}

export interface PlayView {
  /** The scene whose lines are shown: the lit line's, else the one playing. */
  sceneId: string | null;
  /** The scene the activity last reported being in, when the player walks it. */
  playingSceneId: string | null;
  lit: LitLine | null;
}

/** Where a line is said, preferring the scene that is playing when several say it. */
function lineIn(
  scenes: readonly PlayScene[],
  key: string,
  prefer: string | null,
): { scene: PlayScene; line: PlayLine } | null {
  const ordered = prefer
    ? [...scenes.filter((scene) => scene.sceneId === prefer), ...scenes]
    : scenes;
  for (const scene of ordered) {
    const line = scene.lines.find((entry) => entry.key === key);
    if (line) return { scene, line };
  }
  return null;
}

/** The scene a line is said in, for a line chosen in the Script; null for one no scene says. */
export function sceneOfLine(scenes: readonly PlayScene[], key: string): string | null {
  return lineIn(scenes, key, null)?.scene.sceneId ?? null;
}

export function playView(
  scenes: readonly PlayScene[],
  clock: PlayClock,
  pick: LinePick | null,
  now: number,
): PlayView {
  const { scene: reported, audio } = clock;
  const scene = reported && scenes.some((entry) => entry.sceneId === reported.id) ? reported : null;
  const playingSceneId = scene?.id ?? null;
  const spoken = audio ? lineIn(scenes, audio.key, playingSceneId) : null;
  // A line chosen before the activity moved to another scene belongs to a scene left behind.
  const chosen = pick && (!scene || pick.at >= scene.at) ? lineIn(scenes, pick.key, null) : null;
  let lit: LitLine | null = null;
  if (chosen && pick && (!spoken || !audio || pick.at >= audio.at))
    lit = {
      key: chosen.line.key,
      sceneId: chosen.scene.sceneId,
      by: "author",
      word: -1,
      progress: 0,
    };
  else if (spoken && audio) {
    const elapsed = Math.max(0, now - audio.at);
    lit = {
      key: spoken.line.key,
      sceneId: spoken.scene.sceneId,
      by: "player",
      word: spoken.line.timings ? activeWord(spoken.line.timings, elapsed) : -1,
      progress: spoken.line.durationMs > 0 ? Math.min(1, elapsed / spoken.line.durationMs) : 0,
    };
  }
  return {
    sceneId: lit?.sceneId ?? playingSceneId ?? scenes[0]?.sceneId ?? null,
    playingSceneId,
    lit,
  };
}

/** What can be tapped now, for the line under the player. */
export type TapNow =
  /** The activity has not said where it is yet. */
  | { kind: "waiting" }
  /** Nothing can be tapped, and why when the media says. */
  | { kind: "none"; because: "speaking" | "video" | "nothing" }
  | {
      kind: "targets";
      /** Grouped by what a learner does with them, in the order the activity lists them. */
      groups: {
        inputType: PlayerInteractable["inputType"];
        names: string[];
        /** The targets' ids, beside their names, for outlining them in the player. */
        ids: string[];
      }[];
      /** Targets past the ones named. */
      more: number;
    };

export function tapNow(report: PlayerReport | null, clock: PlayClock, limit = 3): TapNow {
  if (!report) return { kind: "waiting" };
  const targets = report.interactables;
  if (!targets.length)
    return {
      kind: "none",
      because: clock.audio ? "speaking" : clock.video ? "video" : "nothing",
    };
  const named = targets.slice(0, Math.max(1, Math.floor(limit)));
  const groups: { inputType: PlayerInteractable["inputType"]; names: string[]; ids: string[] }[] =
    [];
  for (const target of named) {
    const name = target.description?.trim() || target.id;
    const group = groups.find((entry) => entry.inputType === target.inputType);
    if (group) {
      group.names.push(name);
      group.ids.push(target.id);
    } else groups.push({ inputType: target.inputType, names: [name], ids: [target.id] });
  }
  return { kind: "targets", groups, more: targets.length - named.length };
}

/** The least a scene gets on the timeline, in seconds, so a scene without narration still shows. */
export const TIMELINE_MIN_SECONDS = 2;

/** Each scene's share of the timeline: its narration's length, never under the minimum. */
export function timelineWeights(scenes: readonly PlayScene[]): number[] {
  return scenes.map((scene) => Math.max(TIMELINE_MIN_SECONDS, scene.durationMs / 1000));
}

/** The scene before or after one, or null at either end. */
export function neighbourScene(
  scenes: readonly PlayScene[],
  sceneId: string | null,
  step: 1 | -1,
): string | null {
  const index = scenes.findIndex((scene) => scene.sceneId === sceneId);
  if (index < 0) return step > 0 ? (scenes[0]?.sceneId ?? null) : null;
  return scenes[index + step]?.sceneId ?? null;
}
