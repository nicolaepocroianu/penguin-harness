/**
 * What an asset looks like where it is listed, before it is opened: its picture, or its
 * video's first frame, read from wherever the bound file plays (`boundSource`), so a list
 * shows the same file the editor and the player use.
 *
 * Nothing is stored for it. The browser decodes the first frame from the video it would
 * play anyway, so a poster can never go stale against its file. A placeholder is said for
 * what it is and never loaded: every placeholder plays the same stand-in clip, so its picture
 * would say nothing about the asset, and naming it is the point.
 */
import type { MediaAsset } from "@prismshadow/penguin-server/api";
import { bindingOf, type PlaceholderPaths } from "./placeholder-media";
import { boundSource } from "./ref-plan";

export type MediaPreview =
  | { kind: "image" | "video"; src: string }
  /** Bound to the server's placeholder, which still waits for a real file. */
  | { kind: "placeholder" }
  /** Nothing to show: unbound, or a kind of media with no picture (sound, a Lottie). */
  | { kind: "none" };

const NONE: MediaPreview = { kind: "none" };

/**
 * A tenth of a second in: the first frame, past the blank one some encoders lead with. A
 * time is also what makes Safari draw a frame of a video it has not played.
 */
const FIRST_FRAME = "#t=0.1";

export function mediaPreview(
  asset: MediaAsset | undefined,
  endpoint: string,
  placeholders: PlaceholderPaths,
): MediaPreview {
  if (!asset || (asset.type !== "image" && asset.type !== "video")) return NONE;
  if (bindingOf(placeholders, asset.path) === "placeholder") return { kind: "placeholder" };
  const src = boundSource(asset, endpoint);
  if (!src) return NONE;
  return asset.type === "video"
    ? { kind: "video", src: `${src}${FIRST_FRAME}` }
    : { kind: "image", src };
}
