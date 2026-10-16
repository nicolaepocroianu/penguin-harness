/**
 * A clip's shape where it is listed: a few bars drawn from the peak envelope of the file it
 * plays from (waveform.ts), so a list of narration shows where the words are and which line
 * is the long one, and a line being played fills with what has been said.
 *
 * Nothing is stored. The browser decodes each file once per page, only when its row comes
 * into view and a few at a time, and every row drawing the same file shares that decode. A
 * file that cannot be decoded draws nothing; the row around it still names the clip.
 */
import { useEffect, useRef, useState } from "react";
import { normalizePeaks, waveformPeaks } from "./waveform";
import { useInView } from "./media-thumb";

/** The resolution a clip is kept at, finer than any row draws it. */
const ENVELOPE_COLUMNS = 240;
/** Decoding is a whole file each; a long list waits its turn rather than fetching all at once. */
const AT_ONCE = 3;

const envelopes = new Map<string, Promise<number[] | null>>();
let running = 0;
const queued: (() => void)[] = [];

function inTurn<T>(work: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      running += 1;
      work()
        .then(resolve, reject)
        .finally(() => {
          running -= 1;
          queued.shift()?.();
        });
    };
    if (running < AT_ONCE) start();
    else queued.push(start);
  });
}

async function decode(src: string): Promise<number[] | null> {
  try {
    const response = await fetch(src, { credentials: "same-origin" });
    if (!response.ok) return null;
    const bytes = await response.arrayBuffer();
    // An offline context decodes without holding one of the few live audio devices a page gets.
    const Offline =
      window.OfflineAudioContext ??
      (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
        .webkitOfflineAudioContext;
    if (!Offline) return null;
    const decoded = await new Offline(1, 1, 44_100).decodeAudioData(bytes);
    return waveformPeaks(decoded.getChannelData(0), ENVELOPE_COLUMNS);
  } catch {
    return null;
  }
}

/** The clip's envelope, decoded once per page however many rows draw it. */
function clipEnvelope(src: string): Promise<number[] | null> {
  let found = envelopes.get(src);
  if (!found) {
    found = inTurn(() => decode(src));
    envelopes.set(src, found);
  }
  return found;
}

export function ClipWave({
  src,
  bars = 32,
  played = 0,
  className = "",
}: {
  src: string;
  bars?: number;
  /** How much of the clip has been said, 0 to 1: those bars take the text colour. */
  played?: number;
  /** Sizes the drawing (it fills its box) and sets the played bars' colour. */
  className?: string;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const inView = useInView(box, true);
  const [peaks, setPeaks] = useState<{ src: string; values: number[] } | null>(null);
  useEffect(() => {
    if (!inView) return;
    let live = true;
    void clipEnvelope(src).then((envelope) => {
      if (live && envelope)
        setPeaks({
          src,
          values: normalizePeaks(waveformPeaks(Float32Array.from(envelope), bars)),
        });
    });
    return () => {
      live = false;
    };
  }, [inView, src, bars]);
  const values = peaks?.src === src ? peaks.values : null;
  const boundary = Math.round(Math.min(1, Math.max(0, played)) * bars);
  return (
    <span ref={box} aria-hidden className={`block ${className}`}>
      {values && (
        <svg viewBox={`0 0 ${bars * 3} 20`} preserveAspectRatio="none" className="block size-full">
          {values.map((value, index) => {
            const height = Math.max(2, value * 20);
            return (
              <rect
                key={index}
                x={index * 3}
                y={(20 - height) / 2}
                width={2}
                height={height}
                rx={1}
                className={index < boundary ? "fill-current" : "fill-gray-300 dark:fill-gray-600"}
              />
            );
          })}
        </svg>
      )}
    </span>
  );
}
