/**
 * One player for a list of clips: a single audio element every row shares, so starting a line
 * stops the one before it, and a run of lines (a scene) plays through, one after another.
 * Nothing is fetched until a line is played. A clip the browser cannot play is said on its
 * row, never passed over in silence.
 */
import { useRef, useState, type ReactNode } from "react";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { PAUSE_ICON, PLAY_ICON } from "../../components/ui/icons";
import { ICON_SIZE } from "../../lib/icon-scale";
import { S } from "../../lib/strings";

export interface Clip {
  key: string;
  src: string;
}

interface Playing {
  /** The run being played through (a scene's id), or null for one clip. */
  run: string | null;
  clips: readonly Clip[];
  index: number;
}

export interface ClipPlayer {
  /** The clip sounding now, by key; null when nothing is. */
  playing: string | null;
  /** The run playing through, or null for one clip or none. */
  run: string | null;
  /** The clip that could not be played, until another one is. */
  failed: string | null;
  /** Play one clip, or stop it when it is the one sounding. */
  toggle: (clip: Clip) => void;
  /** Play clips one after another from the first, or stop when this run is playing. */
  toggleRun: (run: string, clips: readonly Clip[]) => void;
  /** The shared element, rendered once beside the list. */
  element: ReactNode;
}

export function useClipPlayer(): ClipPlayer {
  const audio = useRef<HTMLAudioElement>(null);
  const [now, setNow] = useState<Playing | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const sounding = now ? (now.clips[now.index] ?? null) : null;

  function start(next: Playing) {
    const element = audio.current;
    const clip = next.clips[next.index];
    if (!element || !clip) {
      setNow(null);
      return;
    }
    setNow(next);
    setFailed(null);
    element.src = clip.src;
    // Starting another clip interrupts this one's load, which is no failure of its file.
    element.play().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFailed(clip.key);
      setNow(null);
    });
  }

  function stop() {
    audio.current?.pause();
    setNow(null);
  }

  return {
    playing: sounding?.key ?? null,
    run: now?.run ?? null,
    failed,
    toggle: (clip) => {
      if (sounding?.key === clip.key && now?.run === null) stop();
      else start({ run: null, clips: [clip], index: 0 });
    },
    toggleRun: (run, clips) => {
      if (now?.run === run) stop();
      else start({ run, clips, index: 0 });
    },
    element: (
      <audio
        ref={audio}
        preload="none"
        hidden
        onEnded={() => {
          if (now && now.index + 1 < now.clips.length) start({ ...now, index: now.index + 1 });
          else setNow(null);
        }}
        // A pause the page did not ask for (the system took the audio) ends the run. The
        // pause that comes with reaching the end is followed by `ended`, which moves it on,
        // and one left over from swapping clips finds the next clip already playing.
        onPause={(event) => {
          const element = event.currentTarget;
          if (element.paused && !element.ended) setNow(null);
        }}
        onError={() => {
          if (sounding) setFailed(sounding.key);
          setNow(null);
        }}
      />
    ),
  };
}

/**
 * A clip's play button where it is listed: one press plays it, another stops it. Named by the
 * clip's words, so a list of them reads as the lines they play.
 */
export function ClipButton({
  clip,
  words,
  player,
}: {
  clip: Clip;
  /** What the clip says or is, when it has words. */
  words: string | undefined;
  player: ClipPlayer;
}) {
  const playing = player.playing === clip.key;
  const copy = S.activities.clipPlayback;
  const line = words?.trim() || null;
  return (
    <button
      type="button"
      aria-label={playing ? copy.stop(line) : copy.play(line)}
      onClick={() => player.toggle(clip)}
      className={`flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors ${
        playing
          ? "border-[var(--accent-bg)] bg-[var(--accent-bg)] text-[var(--accent-fg)]"
          : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300 dark:hover:bg-gray-800"
      }`}
    >
      <GlyphIcon
        d={playing ? PAUSE_ICON : PLAY_ICON}
        size={ICON_SIZE.iconButton}
        filled={!playing}
      />
    </button>
  );
}
