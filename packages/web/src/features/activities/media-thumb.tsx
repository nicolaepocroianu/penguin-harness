/**
 * An asset's picture where it is listed: the image itself, a video's first frame, a
 * placeholder said in words, or its type's mark while there is nothing to show. It fills the
 * box its caller sizes, and it is decorative: the row or card it sits in names the asset and
 * its state in text.
 *
 * A video is decoded only once its box comes into view, since a library can list dozens and
 * each one is a request for its file. A file that cannot be read leaves the type's mark.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { GlyphIcon, ICON_SIZE } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { toneInk, toneSurface } from "../../lib/tone";
import type { MediaPreview } from "./media-preview";
import { SCENE_ASSET_ICON } from "./scene-asset-icons";
import type { SceneAssetType } from "./scene-assets";

/** Whether a box has come within a screen's reach of the viewport; once true it stays true. */
export function useInView(box: RefObject<HTMLElement | null>, wanted: boolean): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!wanted || seen) return;
    const node = box.current;
    // Without an observer (an old browser, a test page) there is nothing to wait for.
    if (!node || typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setSeen(true);
        observer.disconnect();
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [box, wanted, seen]);
  return seen;
}

export function MediaThumb({
  preview,
  type,
  compact = false,
}: {
  preview: MediaPreview;
  type: SceneAssetType;
  /** A row's thumbnail, a few pixels high: marks only, no words. */
  compact?: boolean;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const src = preview.kind === "image" || preview.kind === "video" ? preview.src : null;
  // Keyed by the file, so a binding changed to another file is tried afresh.
  const [failed, setFailed] = useState<string | null>(null);
  const shown = src !== null && failed !== src;
  const inView = useInView(box, shown && preview.kind === "video");
  const mark = compact ? ICON_SIZE.rowMark : ICON_SIZE.sectionMark;
  return (
    <span
      ref={box}
      aria-hidden
      className="relative flex size-full items-center justify-center overflow-hidden bg-gray-100 text-gray-400 dark:bg-gray-900 dark:text-gray-500"
    >
      {preview.kind === "placeholder" ? (
        compact ? (
          <GlyphIcon d={SCENE_ASSET_ICON.video} size={mark} className={toneInk.attention} />
        ) : (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${toneSurface.attention}`}>
            {S.activities.mediaPreview.placeholder}
          </span>
        )
      ) : (
        // Drawn under the picture, so a box still loading or holding a broken file is not blank.
        <GlyphIcon d={SCENE_ASSET_ICON[type]} size={mark} />
      )}
      {shown && preview.kind === "image" && (
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setFailed(src)}
          className="absolute inset-0 size-full object-cover"
        />
      )}
      {shown && preview.kind === "video" && inView && (
        <video
          src={src}
          muted
          playsInline
          preload="metadata"
          tabIndex={-1}
          onError={() => setFailed(src)}
          className="absolute inset-0 size-full object-cover"
        />
      )}
    </span>
  );
}
