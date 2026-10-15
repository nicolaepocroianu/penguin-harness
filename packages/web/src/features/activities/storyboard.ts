/**
 * The storyboard: every scene as a card, in the specification's order, the map an author
 * reads the activity on before opening any one asset. A card shows the scene's picture, its
 * title from the script, and its first beats in the script's own order: what the narrator
 * says, what is shown, and the prose between them, with the media markup read rather than
 * printed.
 *
 * Pure, so the cards, their marks and the tree's marks come from the same reading of the
 * plan, the script and the history.
 */
import { elementText, type ScriptClip } from "./script-media";
import { mediaElementSpans, type MediaElement, type ScriptScene } from "./script-model";
import type { ProposalChange } from "./proposal";
import type { RunKind, RunsIndex } from "./runs-index";
import type { SceneAssetLeaf, SceneAssetTree } from "./scene-assets";
import { scriptSceneFor } from "./studio-tree";

/** The runs that make an asset's file or its text, which mark its frame as being worked on. */
const MEDIA_KINDS: readonly RunKind[] = ["audio", "image", "media-text"];

/** What happens at one moment of a scene: a line said, a picture or clip shown, or prose. */
export type BeatKind = "say" | "image" | "video" | "animation" | "text";

export interface StoryBeat {
  kind: BeatKind;
  /** The words, with no markup; empty for a clip the script gives no words. */
  text: string;
  /** A clip whose binding is the placeholder, which still waits for a real file. */
  placeholder?: boolean;
}

const BEAT_OF: Record<MediaElement, BeatKind> = {
  audio: "say",
  image: "image",
  video: "video",
  animation: "animation",
};

/** Prose as it reads: no tags left open or self-closed, no Markdown marks, single spaces. */
function plain(text: string): string {
  return text
    .replace(/<[^<>]*>/g, " ")
    .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|>\s*|\d+[.)]\s+)/, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A scene's beats, line by line in the order written. A media element becomes a beat of its
 * kind with its words; whatever surrounds it on the line is prose. `clipFor` says which clip
 * an element's words became, so a placeholder video is marked where it is shown.
 */
export function sceneBeats(
  lines: readonly string[],
  clipFor?: (element: MediaElement, text: string) => ScriptClip | null,
): StoryBeat[] {
  const beats: StoryBeat[] = [];
  const prose = (text: string) => {
    const words = plain(text);
    if (words) beats.push({ kind: "text", text: words });
  };
  for (const line of lines) {
    let at = 0;
    for (const span of mediaElementSpans(line)) {
      // An element inside one already read (a tag nested in another) adds nothing new.
      if (span.from < at) continue;
      prose(line.slice(at, span.from));
      const text = plain(elementText(line.slice(span.from, span.to)));
      const clip = clipFor?.(span.element, text);
      beats.push({
        kind: BEAT_OF[span.element],
        text,
        ...(clip?.placeholder ? { placeholder: true } : {}),
      });
      at = span.to;
    }
    prose(line.slice(at));
  }
  return beats;
}

export interface StoryboardFrame {
  sceneId: string;
  /** 1-based position among the scenes. */
  number: number;
  /** The scene's title in the script, or null when the script names no such scene. */
  title: string | null;
  description: string;
  general: boolean;
  /** The scene in the script's words, in order; its description's when the script has none. */
  beats: StoryBeat[];
  /**
   * The asset whose picture stands for the scene: its first bound image, else its first
   * video with a real file, else its first placeholder video, which is shown as one.
   */
  poster: { key: string; type: "image" | "video" } | null;
  /** The asset opened by opening the frame: its first image, else its first asset. */
  firstAssetKey: string | null;
  assetCount: number;
  /** Assets the scene asks for that nothing is bound to yet. */
  unbound: number;
  /** Assets bound only to the placeholder, which still wait for a real file. */
  placeholders: number;
  /** An agent is generating one of this scene's assets right now. */
  working: boolean;
  /** The open proposal changes one of this scene's assets. */
  proposed: boolean;
}

/** The script the frames read their titles and beats from. */
export interface StoryboardScript {
  text: string;
  scenes: readonly ScriptScene[];
  /** The clip a written element became, to mark a placeholder where the script shows it. */
  clipFor?: (element: MediaElement, text: string) => ScriptClip | null;
}

const NO_SCRIPT: StoryboardScript = { text: "", scenes: [] };

function posterOf(assets: readonly SceneAssetLeaf[]): StoryboardFrame["poster"] {
  const image = assets.find((asset) => asset.type === "image" && asset.bound);
  if (image) return { key: image.key, type: "image" };
  const videos = assets.filter((asset) => asset.type === "video" && asset.bound);
  const video = videos.find((asset) => !asset.placeholder) ?? videos[0];
  return video ? { key: video.key, type: "video" } : null;
}

/**
 * Every asset bound only to the placeholder, once each, where the board first shows it: the
 * board says how many there are once and opens the first of them.
 */
export function placeholderAssets(tree: SceneAssetTree): { sceneId: string; key: string }[] {
  const seen = new Set<string>();
  return tree.scenes.flatMap((scene) =>
    scene.categories.flatMap((category) =>
      category.assets.flatMap((asset) => {
        if (!asset.placeholder || seen.has(asset.key)) return [];
        seen.add(asset.key);
        return [{ sceneId: scene.sceneId, key: asset.key }];
      }),
    ),
  );
}

export function storyboardFrames(
  tree: SceneAssetTree,
  runs: RunsIndex,
  proposal: readonly ProposalChange[],
  language: string,
  script: StoryboardScript = NO_SCRIPT,
): StoryboardFrame[] {
  const working = (assetKey: string) =>
    MEDIA_KINDS.some((kind) => runs.isRunning(kind, { language, assetKey }));
  const proposed = new Set(
    proposal.flatMap((change) =>
      change.target === "media" && change.language === language ? [change.assetKey] : [],
    ),
  );
  const lines = script.text.replace(/\r\n/g, "\n").split("\n");
  return tree.scenes.map((scene, index) => {
    const assets = scene.categories.flatMap((category) => category.assets);
    const images = scene.categories.find((category) => category.type === "image")?.assets ?? [];
    const named = scriptSceneFor(scene.sceneId, script.scenes);
    // `heading` is the heading's 1-based line, so the body starts at that index.
    const body = named ? lines.slice(named.heading, named.last) : scene.description.split("\n");
    return {
      sceneId: scene.sceneId,
      number: index + 1,
      title: named?.title ?? null,
      description: scene.description,
      general: scene.general,
      beats: sceneBeats(body, script.clipFor),
      poster: posterOf(assets),
      firstAssetKey: images[0]?.key ?? assets[0]?.key ?? null,
      assetCount: assets.length,
      unbound: assets.filter((asset) => !asset.bound).length,
      placeholders: assets.filter((asset) => asset.placeholder).length,
      working: assets.some((asset) => working(asset.key)),
      proposed: assets.some((asset) => proposed.has(asset.key)),
    };
  });
}
