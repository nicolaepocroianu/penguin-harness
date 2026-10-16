/**
 * Beside the player, or under it in a narrow panel: the scene being shown and its narration,
 * the line being said lit with its word and how far through it is, and what can be tapped
 * now, in words rather than the module's state names (play-model.ts works all of it out).
 *
 * Choosing a line lights it here and in the Script, which scrolls to it; it never restarts
 * the activity. The timeline under the player is what plays a scene again.
 */
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { ICON_SIZE } from "../../lib/icon-scale";
import { S } from "../../lib/strings";
import { toneDot } from "../../lib/tone";
import { ClipWave } from "./clip-wave";
import type { PlayScene, PlayView, TapNow } from "./play-model";
import { formatClipLength } from "./script-media";

/** A speaker with its sound: the line being said. */
export const SPEAKING_ICON = "M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13";
/** A target's crosshair: what can be tapped. */
const TAP_ICON = "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 3v4M12 17v4M3 12h4M17 12h4";

/** The words of what can be tapped now; null while the activity has said nothing. */
function tapText(tap: TapNow): string | null {
  const words = S.activities.studioPlay.tap;
  if (tap.kind === "waiting") return null;
  if (tap.kind === "none") return words[tap.because];
  return words.targets(
    tap.groups.map((group) => ({ verb: words.verbs[group.inputType], names: group.names })),
    tap.more,
  );
}

export function PlayNow({
  scene,
  view,
  tap,
  state,
  status,
  quiet,
  onLine,
}: {
  /** The scene the view shows; null before the plan names any. */
  scene: PlayScene | null;
  view: PlayView;
  tap: TapNow;
  /** The state as the module names it, for whoever reads machine ids; null before a report. */
  state: string | null;
  /** Why nothing is known yet: the activity has not reported, or never will. */
  status: string | null;
  /** The module says nothing of its media, so no line lights as it plays. */
  quiet: boolean;
  onLine?: (key: string) => void;
}) {
  const words = S.activities.studioPlay;
  const name = scene ? words.scene(scene.number, scene.title) : words.now;
  const playing = !!scene && scene.sceneId === view.playingSceneId;
  const tapping = tapText(tap);
  return (
    <section aria-label={words.now} className="space-y-2">
      <div className="flex min-w-0 items-center gap-2">
        {playing && (
          <span
            aria-hidden
            className={`size-1.5 shrink-0 rounded-full motion-safe:animate-pulse ${toneDot.busy}`}
          />
        )}
        <h3 className="min-w-0 truncate text-xs font-semibold">{name}</h3>
      </div>
      {scene && scene.lines.length > 0 ? (
        <ol aria-label={words.lines(name)} className="space-y-0.5">
          {scene.lines.map((line) => {
            const lit = view.lit?.key === line.key && view.lit.sceneId === scene.sceneId;
            const said = lit && view.lit!.by === "player";
            const length = formatClipLength(line.durationMs);
            return (
              <li key={line.key}>
                <button
                  type="button"
                  aria-current={lit ? "true" : undefined}
                  aria-label={words.showLine(line.words || line.key)}
                  disabled={!onLine}
                  onClick={() => onLine?.(line.key)}
                  className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left disabled:cursor-default ${
                    lit
                      ? "bg-brand-50 text-brand-900 dark:bg-brand-950 dark:text-brand-100"
                      : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-900"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`mt-0.5 ${lit ? "text-brand-600 dark:text-brand-300" : "text-gray-400"}`}
                  >
                    {said ? (
                      <GlyphIcon d={SPEAKING_ICON} size={ICON_SIZE.rowLead} />
                    ) : (
                      <span className="flex size-3.5 items-center justify-center">
                        <span className="size-1.5 rounded-full bg-current" />
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className={`block text-xs leading-5 ${lit ? "font-medium" : ""}`}>
                      {said && line.timings
                        ? line.timings.map((timing, index) => (
                            <span
                              key={`${index}-${timing.startMs}`}
                              className={
                                index === view.lit!.word
                                  ? "rounded bg-brand-100 px-0.5 dark:bg-brand-900"
                                  : ""
                              }
                            >
                              {index ? " " : ""}
                              {timing.word}
                            </span>
                          ))
                        : line.words || <span className="font-mono">{line.key}</span>}
                    </span>
                    {said && line.src && (
                      <ClipWave
                        src={line.src}
                        bars={40}
                        played={view.lit!.progress}
                        className="h-3.5 w-full text-brand-600 dark:text-brand-300"
                      />
                    )}
                    {lit && <span className="sr-only">{said ? words.speaking : words.chosen}</span>}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-gray-400 tabular-nums">
                    {line.estimated ? words.about(length) : length}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        scene && <p className="px-2 text-xs text-gray-500 dark:text-gray-400">{words.noLines}</p>
      )}
      <p
        role="status"
        aria-live="polite"
        className="flex items-start gap-2 px-2 text-xs text-gray-600 dark:text-gray-300"
      >
        <GlyphIcon d={TAP_ICON} size={ICON_SIZE.inlineGlyph} className="mt-0.5 text-gray-400" />
        <span className="min-w-0">{tapping ?? status}</span>
      </p>
      {state && (
        <p
          title={words.state(state)}
          className="truncate px-2 font-mono text-xs text-gray-400 dark:text-gray-500"
        >
          {state}
        </p>
      )}
      {quiet && <p className="px-2 text-xs text-gray-500 dark:text-gray-400">{words.quiet}</p>}
    </section>
  );
}
