/**
 * A speech clip with its shape drawn above it. The picture is geometry rather than an
 * icon, so it draws itself on a canvas, like the app's other charts.
 *
 * Nothing is fetched until the author asks: narration lists can be long, and decoding
 * every clip on mount would pull the whole activity's audio down to render a page. The
 * native player underneath owns playback and keyboard control, so the canvas never has
 * to reimplement either; it adds seeking by position and a place to see where the words
 * are. When decoding is unavailable or fails, the player stays and only the picture is
 * missing, which is said rather than left blank.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { S } from "../../lib/strings";
import { usePrefersReducedMotion } from "../../components/ui/use-reduced-motion";
import { clipTime, normalizePeaks, playedFraction, seekTime, waveformPeaks } from "./waveform";

const COLUMN_WIDTH = 3;
const COLUMN_GAP = 1;

export function WaveformPlayer({
  src,
  label,
  /** Drawn straight away, for the one clip an author is working on. */
  autoLoad = false,
}: {
  src: string;
  label: string;
  autoLoad?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [requested, setRequested] = useState(autoLoad);
  const [failed, setFailed] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    setPeaks(null);
    setFailed(false);
    setPosition(0);
    setDuration(0);
    setRequested(autoLoad);
  }, [src, autoLoad]);

  useEffect(() => {
    if (!requested || peaks || failed) return;
    let cancelled = false;
    // decodeAudioData wants the whole clip, so this runs once per clip and never per frame.
    void (async () => {
      try {
        // Safari still exposes the prefixed constructor only.
        const Context =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Context) throw new Error("no audio context");
        const response = await fetch(src, { credentials: "same-origin" });
        if (!response.ok) throw new Error(String(response.status));
        const context = new Context();
        try {
          const decoded = await context.decodeAudioData(await response.arrayBuffer());
          if (cancelled) return;
          const columns = Math.max(
            1,
            Math.floor((canvasRef.current?.clientWidth ?? 320) / (COLUMN_WIDTH + COLUMN_GAP)),
          );
          setPeaks(normalizePeaks(waveformPeaks(decoded.getChannelData(0), columns)));
          setDuration(decoded.duration);
        } finally {
          void context.close();
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requested, peaks, failed, src]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !peaks?.length) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.floor(width * ratio));
    canvas.height = Math.max(1, Math.floor(height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    // currentColor is not available to canvas, so the two inks are read from the element.
    const styles = getComputedStyle(canvas);
    const played = styles.getPropertyValue("color");
    const rest = styles.getPropertyValue("background-color");
    const boundary = playedFraction(position, duration) * peaks.length;
    for (const [index, peak] of peaks.entries()) {
      const bar = Math.max(1, peak * (height - 2));
      context.fillStyle = index < boundary ? played : rest;
      context.fillRect(index * (COLUMN_WIDTH + COLUMN_GAP), (height - bar) / 2, COLUMN_WIDTH, bar);
    }
  }, [peaks, position, duration]);

  function seek(clientX: number) {
    const canvas = canvasRef.current;
    const audio = audioRef.current;
    if (!canvas || !audio || !duration) return;
    const rect = canvas.getBoundingClientRect();
    audio.currentTime = seekTime(clientX - rect.left, rect.width, duration);
  }

  return (
    <div className="space-y-1">
      {peaks?.length ? (
        <div
          role="slider"
          tabIndex={0}
          aria-label={`${S.activities.waveform}: ${label}`}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(position)}
          aria-valuetext={`${clipTime(position)} / ${clipTime(duration)}`}
          onClick={(event) => seek(event.clientX)}
          onKeyDown={(event) => {
            const audio = audioRef.current;
            if (!audio) return;
            if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
              event.preventDefault();
              audio.currentTime = Math.min(
                duration,
                Math.max(0, audio.currentTime + (event.key === "ArrowRight" ? 1 : -1)),
              );
            }
          }}
          className="w-full cursor-pointer rounded focus-visible:ring-2 focus-visible:ring-gray-400/40"
        >
          <canvas
            ref={canvasRef}
            aria-hidden
            // The canvas reads both inks off itself: text for played, background for the rest.
            className="block h-12 w-full bg-gray-300 text-gray-900 dark:bg-gray-700 dark:text-gray-100"
          />
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {!requested ? (
            <Button size="sm" onClick={() => setRequested(true)}>
              {S.activities.showWaveform}
            </Button>
          ) : failed ? (
            <p role="status" className="text-xs text-gray-500">
              {S.activities.waveformUnavailable}
            </p>
          ) : (
            <p role="status" className="text-xs text-gray-500">
              {S.activities.waveformLoading}
            </p>
          )}
        </div>
      )}
      <audio
        ref={audioRef}
        aria-label={label}
        controls
        preload="none"
        src={src}
        className="w-full"
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          if (Number.isFinite(value) && !duration) setDuration(value);
        }}
        onTimeUpdate={(event) => {
          // Reduced motion keeps the picture still; the native player still reads out time.
          if (!reducedMotion) setPosition(event.currentTarget.currentTime);
        }}
        onSeeked={(event) => setPosition(event.currentTarget.currentTime)}
      />
      {duration > 0 && (
        <p className="text-xs text-gray-500">
          {clipTime(position)} / {clipTime(duration)}
        </p>
      )}
    </div>
  );
}
