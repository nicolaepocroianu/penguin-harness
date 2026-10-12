/**
 * The storyboard: every scene as a frame, in the specification's order, the map an author
 * reads the activity on before opening any one asset.
 *
 * Pure, so the frames, their marks and the tree's marks come from the same reading of the
 * plan and the history.
 */
import type { AssetManifest } from "@prismshadow/penguin-server/api";
import type { ProposalChange } from "./proposal";
import type { RunKind, RunsIndex } from "./runs-index";
import type { SceneAssetTree } from "./scene-assets";

type MediaAsset = AssetManifest["assets"][string][number];

/** The runs that make an asset's file or its text, which mark its frame as being worked on. */
const MEDIA_KINDS: readonly RunKind[] = ["audio", "image", "media-text"];

export interface StoryboardFrame {
  sceneId: string;
  /** 1-based position among the scenes. */
  number: number;
  description: string;
  general: boolean;
  /** The image a frame shows: the scene's first image that the saved plan has bound. */
  thumbnailKey: string | null;
  /** The asset opened by opening the frame: its first image, else its first asset. */
  firstAssetKey: string | null;
  assetCount: number;
  /** Assets the scene asks for that nothing is bound to yet. */
  unbound: number;
  /** An agent is generating one of this scene's assets right now. */
  working: boolean;
  /** The open proposal changes one of this scene's assets. */
  proposed: boolean;
}

export function storyboardFrames(
  tree: SceneAssetTree,
  saved: readonly MediaAsset[],
  runs: RunsIndex,
  proposal: readonly ProposalChange[],
  language: string,
): StoryboardFrame[] {
  const shown = new Set(
    saved
      .filter((asset) => asset.type === "image" && (asset.path || asset.generatedImage))
      .map((asset) => asset.key),
  );
  const working = (assetKey: string) =>
    MEDIA_KINDS.some((kind) => runs.isRunning(kind, { language, assetKey }));
  const proposed = new Set(
    proposal.flatMap((change) =>
      change.target === "media" && change.language === language ? [change.assetKey] : [],
    ),
  );
  return tree.scenes.map((scene, index) => {
    const assets = scene.categories.flatMap((category) => category.assets);
    const images = scene.categories.find((category) => category.type === "image")?.assets ?? [];
    return {
      sceneId: scene.sceneId,
      number: index + 1,
      description: scene.description,
      general: scene.general,
      thumbnailKey: images.find((asset) => shown.has(asset.key))?.key ?? null,
      firstAssetKey: images[0]?.key ?? assets[0]?.key ?? null,
      assetCount: assets.length,
      unbound: assets.filter((asset) => !asset.bound).length,
      working: assets.some((asset) => working(asset.key)),
      proposed: assets.some((asset) => proposed.has(asset.key)),
    };
  });
}
