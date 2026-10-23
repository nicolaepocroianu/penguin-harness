/**
 * What a waveform says and offers while a clip can be trimmed: how to select, the start a
 * keyboard selection marked, or the selection itself with its length, the length that would
 * remain, and the ways to hear it or cut it out. The cut happens on the server (FFmpeg, MP3,
 * as Loom trims), so the bar only reports what it is asked to show.
 */
import { Button } from "@waterford/waf-harness-ui";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { clipTime, remainingLength } from "./waveform";

export function WaveformTrimBar({
  duration,
  selection,
  mark,
  trimming,
  error,
  savesInPlace = false,
  onPlay,
  onPlayRemaining,
  onRemove,
  onClear,
}: {
  duration: number;
  selection: { start: number; end: number } | null;
  /** Where a keyboard selection started, while its end is still to be chosen. */
  mark: number | null;
  trimming: boolean;
  error: string | null;
  /** The clip is the bound one, so saving the trim cuts the same stretch out of it in place. */
  savesInPlace?: boolean;
  onPlay: () => void;
  onPlayRemaining: () => void;
  onRemove: () => void;
  onClear: () => void;
}) {
  const words = S.activities.waveformTrim;
  return (
    <>
      {selection ? (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span aria-live="polite" className="text-xs text-gray-600 dark:text-gray-300">
              {words.selected(clipTime(selection.start), clipTime(selection.end))}
              {" · "}
              {words.remains(clipTime(remainingLength(duration, selection)))}
            </span>
            <Button size="sm" variant="ghost" onClick={onPlay} disabled={trimming}>
              {words.play}
            </Button>
            <Button size="sm" variant="ghost" onClick={onPlayRemaining} disabled={trimming}>
              {words.playRemaining}
            </Button>
            <Button size="sm" onClick={onRemove} disabled={trimming}>
              {trimming ? words.working : words.remove}
            </Button>
            <Button size="sm" variant="ghost" onClick={onClear} disabled={trimming}>
              {words.clear}
            </Button>
          </div>
          <p className="text-xs text-gray-500">
            {words.handles}
            {savesInPlace ? ` ${words.savesInPlace}` : ""}
          </p>
        </div>
      ) : mark !== null ? (
        <p aria-live="polite" className="text-xs text-gray-600 dark:text-gray-300">
          {words.marked(clipTime(mark))}
        </p>
      ) : (
        <p className="text-xs text-gray-500">{words.hint}</p>
      )}
      {error && (
        <p role="alert" className={`text-xs ${toneInk.danger}`}>
          {words.failed(error)}
        </p>
      )}
    </>
  );
}
