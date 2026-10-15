/**
 * The Scenes section's first view: the storyboard. Each scene is a card in the
 * specification's order: its picture, its title from the script, and its first beats as the
 * script says them, marked when an agent is working on it, when a proposal waits for it, or
 * when it still lacks media. Placeholder videos are counted once for the whole board.
 * Choosing a card makes it the scene the conversation is about; opening it opens its media.
 */
import type { SceneAssetLeaf } from "./scene-assets";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { ICON_GAP, ICON_SIZE } from "../../lib/icon-scale";
import { S } from "../../lib/strings";
import { toneDot, toneInk, toneStrip, toneSurface } from "../../lib/tone";
import type { MediaPreview } from "./media-preview";
import { MediaThumb } from "./media-thumb";
import { SCENE_ASSET_ICON } from "./scene-asset-icons";
import type { BeatKind, StoryBeat, StoryboardFrame } from "./storyboard";

const BEAT_ICON: Record<BeatKind, string> = {
  say: SCENE_ASSET_ICON.audio,
  image: SCENE_ASSET_ICON.image,
  video: SCENE_ASSET_ICON.video,
  animation: SCENE_ASSET_ICON.animation,
  /** Three ruled lines: the script's own prose. */
  text: "M4 7h16M4 12h16M4 17h10",
};

/** How many beats a card shows before it says how many more there are. */
const SHOWN_BEATS = 3;

/** A beat's words, or its kind when the script gives the clip none. Prose always has words. */
function beatText(beat: StoryBeat): string {
  if (beat.text || beat.kind === "text") return beat.text;
  return S.activities.mediaTypes[beat.kind === "say" ? "audio" : beat.kind];
}

function Beat({ beat }: { beat: StoryBeat }) {
  return (
    <span className={`flex items-start ${ICON_GAP.row} text-xs text-gray-700 dark:text-gray-300`}>
      <span
        className={`mt-0.5 ${beat.placeholder ? toneInk.attention : "text-gray-400 dark:text-gray-500"}`}
      >
        <GlyphIcon d={BEAT_ICON[beat.kind]} size={ICON_SIZE.inlineGlyph} />
      </span>
      <span className="line-clamp-1 min-w-0 flex-1">
        {beatText(beat)}
        {beat.placeholder && (
          <span className={`ml-1.5 ${toneInk.attention}`}>
            {S.activities.studioBoard.beatPlaceholder}
          </span>
        )}
      </span>
    </span>
  );
}

export function Storyboard({
  frames,
  selected,
  assetsOf,
  previewOf,
  placeholders,
  onSelect,
  onOpen,
  onPlay,
  onEditMedia,
  onAssemble,
}: {
  frames: readonly StoryboardFrame[];
  selected: string | null;
  /** The chosen scene's media, for the sheet above the frames. */
  assetsOf: (sceneId: string) => SceneAssetLeaf[];
  /** What an asset looks like: its picture, its video's first frame, or a placeholder. */
  previewOf: (assetKey: string) => MediaPreview;
  /** Every asset bound only to the placeholder, once each, where the board first shows it. */
  placeholders: readonly { sceneId: string; key: string }[];
  onSelect: (sceneId: string) => void;
  onOpen: (sceneId: string, assetKey: string) => void;
  onPlay: () => void;
  /** Leave the board for the per-asset editor, on the chosen scene when there is one. */
  onEditMedia: () => void;
  /** Open the Build stage, where assembling is checked and started. */
  onAssemble: () => void;
}) {
  const words = S.activities.studioBoard;
  const current = frames.find((frame) => frame.sceneId === selected) ?? null;
  const name = (frame: StoryboardFrame) => frame.title ?? frame.sceneId;
  const label = (frame: StoryboardFrame) =>
    frame.general ? words.shared : words.scene(frame.number, name(frame));
  const firstPlaceholder = placeholders[0];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-2 dark:border-gray-800">
        <h2 className="text-sm font-semibold">{words.title}</h2>
        <span className="text-xs text-gray-500">{words.count(frames.length)}</span>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onEditMedia}>
          {words.editMedia}
        </Button>
        <Button size="sm" variant="ghost" onClick={onPlay}>
          {words.play}
        </Button>
        <Button size="sm" onClick={onAssemble}>
          {words.assemble}
        </Button>
      </div>
      {current && (
        <div className="space-y-1.5 border-b border-gray-200 px-4 py-2.5 dark:border-gray-800">
          <div className="flex items-baseline gap-2">
            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{label(current)}</h3>
            {current.firstAssetKey && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onOpen(current.sceneId, current.firstAssetKey!)}
              >
                {words.open}
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {assetsOf(current.sceneId).length === 0 ? (
              <span className="text-xs text-gray-500">{words.noAssets}</span>
            ) : (
              assetsOf(current.sceneId).map((asset) => (
                <button
                  key={asset.key}
                  type="button"
                  onClick={() => onOpen(current.sceneId, asset.key)}
                  className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-950"
                >
                  {asset.key}
                  {!asset.bound && (
                    <span
                      role="img"
                      aria-label={words.unbound(1)}
                      className={`size-1.5 rounded-full ${toneDot.attention}`}
                    />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {firstPlaceholder && (
          <div
            className={`flex flex-wrap items-center ${ICON_GAP.menu} rounded-md border px-3 py-2 text-xs ${toneStrip.attention}`}
          >
            <span className="min-w-0 flex-1">
              <span className="font-semibold">{words.placeholderNotice(placeholders.length)}</span>{" "}
              {words.placeholderNoticeBody}
            </span>
            <Button
              size="sm"
              onClick={() => onOpen(firstPlaceholder.sceneId, firstPlaceholder.key)}
            >
              {words.reviewPlaceholders}
            </Button>
          </div>
        )}
        {frames.length === 0 ? (
          <EmptyState title={words.empty} />
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">
            {frames.map((frame) => {
              const chosen = frame.sceneId === selected;
              const states = [
                frame.working && words.working,
                frame.proposed && words.proposed,
                frame.unbound > 0 && words.unbound(frame.unbound),
                frame.placeholders > 0 && words.placeholders(frame.placeholders),
              ].filter(Boolean);
              const poster: MediaPreview = frame.poster
                ? previewOf(frame.poster.key)
                : { kind: "none" };
              const lines = frame.beats.filter((beat) => beat.kind === "say").length;
              const shown = frame.beats.slice(0, SHOWN_BEATS);
              const more = frame.beats.length - shown.length;
              return (
                <li key={frame.sceneId}>
                  <button
                    type="button"
                    aria-pressed={chosen}
                    aria-label={[label(frame), ...states].join(". ")}
                    onClick={() => onSelect(frame.sceneId)}
                    onDoubleClick={() =>
                      frame.firstAssetKey && onOpen(frame.sceneId, frame.firstAssetKey)
                    }
                    // A waiting proposal is drawn as a ghost: the card's outline dashed, with
                    // the attention dot in its caption carrying the state.
                    className={`block w-full overflow-hidden rounded-lg border text-left ${
                      frame.proposed ? "border-dashed" : ""
                    } ${
                      chosen
                        ? "border-brand-600 ring-2 ring-brand-600/25"
                        : frame.proposed
                          ? "border-gray-400 dark:border-gray-500"
                          : "border-gray-200 hover:border-gray-400 dark:border-gray-800 dark:hover:border-gray-600"
                    }`}
                  >
                    <span className="relative block aspect-[4/3] border-b border-gray-200 dark:border-gray-800">
                      <MediaThumb preview={poster} type={frame.poster?.type ?? "image"} />
                      <span
                        aria-hidden
                        className="absolute left-2 top-2 grid size-6 place-items-center rounded-md bg-black/55 text-xs font-semibold text-white tabular-nums"
                      >
                        {frame.number}
                      </span>
                      {frame.placeholders > 0 && poster.kind !== "placeholder" && (
                        <span
                          aria-hidden
                          className={`absolute right-2 top-2 rounded-full px-2 py-0.5 text-xs font-medium ${toneSurface.attention}`}
                        >
                          {words.placeholders(frame.placeholders)}
                        </span>
                      )}
                    </span>
                    <span className="block space-y-2 px-3 py-2.5">
                      <span className="flex items-center gap-1.5">
                        <span
                          className={`min-w-0 flex-1 truncate text-sm font-medium ${chosen ? "text-brand-700 dark:text-brand-300" : ""}`}
                        >
                          {frame.general ? words.shared : name(frame)}
                        </span>
                        {frame.proposed && (
                          <span
                            aria-hidden
                            className={`size-1.5 shrink-0 rounded-full ${toneDot.attention}`}
                          />
                        )}
                        {frame.working && (
                          <span
                            aria-hidden
                            className={`size-1.5 shrink-0 animate-pulse rounded-full ${toneDot.busy}`}
                          />
                        )}
                        {frame.unbound > 0 && (
                          <span
                            aria-hidden
                            className={`size-1.5 shrink-0 rounded-full ${toneDot.attention}`}
                          />
                        )}
                        {lines > 0 && (
                          <span className="shrink-0 text-xs text-gray-500 tabular-nums dark:text-gray-400">
                            {S.activities.clipPlayback.lines(lines)}
                          </span>
                        )}
                      </span>
                      {shown.length === 0 ? (
                        <span className="block text-xs text-gray-500 dark:text-gray-400">
                          {words.noBeats}
                        </span>
                      ) : (
                        <span className="grid gap-1">
                          {shown.map((beat, index) => (
                            <Beat key={index} beat={beat} />
                          ))}
                        </span>
                      )}
                      {more > 0 && (
                        <span className="block text-xs text-gray-500 dark:text-gray-400">
                          {words.more(more)}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
