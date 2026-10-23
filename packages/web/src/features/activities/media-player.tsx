/**
 * One preview for whichever kind of media a binding points at. Images reuse the
 * workbench's load-on-request preview; sound and motion use the platform players,
 * which fetch nothing until asked, unless the one video an editor shows asks for its
 * first frame.
 */
import type { UploadKind } from "@waterford/waf-harness-server/api";
import { S } from "../../lib/strings";
import { ImagePreview } from "./image-preview";

export function MediaPlayer({
  kind,
  src,
  label,
  captions,
  preload = "none",
}: {
  kind: UploadKind;
  src: string;
  label: string;
  /** A video's captions, as WebVTT, and their language. */
  captions?: { src: string; language: string };
  /** "metadata" reads enough of a video to show its first frame and length before it plays. */
  preload?: "none" | "metadata";
}) {
  if (kind === "image") return <ImagePreview key={src} src={src} description={label} />;
  if (kind === "audio")
    return (
      <audio
        key={src}
        aria-label={`${S.activities.playMedia}: ${label}`}
        controls
        preload="none"
        src={src}
        className="w-full"
      />
    );
  return (
    <video
      key={src}
      aria-label={`${S.activities.playMedia}: ${label}`}
      controls
      preload={preload}
      src={src}
      className="max-h-72 w-full rounded border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900"
    >
      {captions && (
        <track
          kind="captions"
          src={captions.src}
          srcLang={captions.language}
          label={S.activities.video.captionsTrack}
          default
        />
      )}
    </video>
  );
}
