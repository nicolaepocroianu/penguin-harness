/**
 * One preview for whichever kind of media a binding points at. Images reuse the
 * workbench's load-on-request preview; sound and motion use the platform players,
 * which fetch nothing until asked.
 */
import type { UploadKind } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { ImagePreview } from "./image-preview";

export function MediaPlayer({
  kind,
  src,
  label,
  captions,
}: {
  kind: UploadKind;
  src: string;
  label: string;
  /** A video's captions, as WebVTT, and their language. */
  captions?: { src: string; language: string };
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
      preload="none"
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
