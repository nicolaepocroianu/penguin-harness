/**
 * Under the player: restart, the scene before and after, and the activity's scenes as a
 * timeline of their pictures, each as wide as its narration is long, so the long scenes read
 * as long. Choosing a scene plays the activity again from it. The scene playing is marked;
 * one shown for a line chosen elsewhere is ringed.
 */
import { Dot, GlyphIcon, ICON_SIZE, ICONS } from "@waterford/waf-harness-ui";
import { S } from "../../lib/strings";
import { toneName } from "../../lib/tone";
import { MediaThumb } from "./media-thumb";
import { neighbourScene, timelineWeights, type PlayScene } from "./play-model";

const CONTROL =
  "rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-40 disabled:hover:bg-transparent dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200";

export function PlayTimeline({
  scenes,
  playingSceneId,
  shownSceneId,
  onRestart,
  onJump,
}: {
  scenes: readonly PlayScene[];
  playingSceneId: string | null;
  shownSceneId: string | null;
  onRestart: () => void;
  /** Play the activity again from this scene. */
  onJump: (sceneId: string) => void;
}) {
  const words = S.activities.studioPlay;
  const weights = timelineWeights(scenes);
  const previous = neighbourScene(scenes, playingSceneId, -1);
  const next = neighbourScene(scenes, playingSceneId, 1);
  return (
    <div className="flex min-w-0 items-start gap-2">
      <div className="flex shrink-0 items-center gap-1 pt-2">
        <button
          type="button"
          aria-label={words.restart}
          data-tooltip={words.restart}
          onClick={onRestart}
          className={CONTROL}
        >
          <GlyphIcon d={ICONS.rotateCcw} size={ICON_SIZE.iconButton} />
        </button>
        <button
          type="button"
          aria-label={words.previous}
          data-tooltip={words.previous}
          disabled={!previous}
          onClick={() => previous && onJump(previous)}
          className={CONTROL}
        >
          <GlyphIcon d={ICONS.chevronLeftPipe} size={ICON_SIZE.iconButton} />
        </button>
        <button
          type="button"
          aria-label={words.next}
          data-tooltip={words.next}
          disabled={!next}
          onClick={() => next && onJump(next)}
          className={CONTROL}
        >
          <GlyphIcon d={ICONS.chevronRightPipe} size={ICON_SIZE.iconButton} />
        </button>
      </div>
      {scenes.length > 0 && (
        <ol aria-label={words.timeline} className="flex min-w-0 flex-1 gap-1">
          {scenes.map((scene, index) => {
            const name = words.scene(scene.number, scene.title);
            const playing = scene.sceneId === playingSceneId;
            const shown = scene.sceneId === shownSceneId && !playing;
            return (
              <li
                key={scene.sceneId}
                // A scene's share of the row is its narration's length; every scene keeps
                // room enough for its picture to read as one.
                style={{ flex: `${weights[index]} 1 0` }}
                className="min-w-10"
              >
                <button
                  type="button"
                  aria-current={playing ? "step" : undefined}
                  aria-label={words.jump(name)}
                  data-tooltip={name}
                  onClick={() => onJump(scene.sceneId)}
                  className="group block w-full text-left"
                >
                  <span
                    className={`relative block h-10 overflow-hidden rounded border ${
                      playing
                        ? "border-[var(--accent-bg)] ring-1 ring-[var(--accent-bg)]"
                        : shown
                          ? "border-gray-500 dark:border-gray-400"
                          : "border-gray-200 opacity-80 group-hover:opacity-100 dark:border-gray-800"
                    }`}
                  >
                    <MediaThumb preview={scene.preview} type="video" compact />
                    {playing && (
                      <Dot tone={toneName.busy} pulse className="absolute top-1 left-1" />
                    )}
                  </span>
                  <span
                    className={`mt-0.5 block truncate text-xs ${
                      playing
                        ? "font-medium text-gray-900 dark:text-gray-100"
                        : "text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    {scene.title ? `${scene.number} ${scene.title}` : scene.number}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
