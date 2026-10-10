/**
 * The final check of a video a run made (experimental, behind `activityVideoExperiment`): one
 * FFmpeg pass that reads the file back and measures it, and what that says against what the
 * video should be.
 *
 * FFmpeg reports the file's length, picture size, frame rate and whether it has sound as it
 * opens it, and filters report the rest as they go: `blackdetect` (stretches of black
 * picture), `signalstats` (each frame's brightness, for flashing), `silencedetect` (stretches of
 * silence) and `volumedetect` (mean and peak loudness).
 * Nothing is decoded twice and nothing is written.
 *
 * What it checks follows OpenMontage's final review of a render (`_run_final_review` in its
 * video_compose tool) as an idea only: a probe of the container, a look for black, and a listen
 * for silence and clipping; its thresholds are Penguin's own. The checker does not judge the
 * picture's content; an author still watches the video.
 */
import { ffmpegReport } from "./ffmpeg.js";
import type { VideoCheck, VideoCheckFinding } from "./video-types.js";

/** How long a check may take. */
export const CHECK_TIMEOUT_MS = 5 * 60_000;
/** A length within this share, or within `DURATION_SLACK_MS`, of the expected one is right. */
export const DURATION_TOLERANCE = 0.05;
export const DURATION_SLACK_MS = 250;
/** Further off than this share is an error rather than a warning. */
export const DURATION_ERROR = 0.25;
/** The shortest black stretch reported, and how much black makes the whole video an error. */
export const BLACK_MIN_SECONDS = 0.5;
export const BLACK_ERROR_SHARE = 0.9;
/** Quieter than this on average is silent. */
export const SILENT_MEAN_DB = -60;
/** A peak above this is at the edge of distorting. */
export const CLIPPING_PEAK_DB = -0.5;
/** A narration this much covered by silence is not being heard. */
export const NARRATION_SILENT_SHARE = 0.8;
/**
 * WCAG 2.3.1's general flash: a change of at least a tenth in relative luminance, with the darker
 * side under 0.8, and more than three flashes (pairs of opposing changes) in any one second.
 */
export const FLASH_CHANGE = 0.1;
export const FLASH_DARK = 0.8;
export const FLASHES_PER_SECOND = 3;
/** WCAG 2.3.1's red flash: a saturated red, and how far it must change. */
export const SATURATED_RED = 0.8;
export const RED_FLASH_CHANGE = 20;

/** What the video should be. */
export interface VideoExpectation {
  durationMs: number;
  width: number;
  height: number;
  /** Whether it should have sound at all. */
  audio: boolean;
  /** Where each narration should be speaking. */
  narration: { asset: string; startMs: number; endMs: number }[];
}

/**
 * FFmpeg's arguments for analysing `file`: the probe, black, and the sound's silence and
 * loudness (ignored when it has none).
 */
export function checkArgs(file: string): string[] {
  return [
    "-hide_banner",
    "-nostats",
    "-i",
    file,
    "-vf",
    `blackdetect=d=${BLACK_MIN_SECONDS}:pix_th=0.10,signalstats,` +
      ["Y", "U", "V"].map((plane) => `metadata=print:key=lavfi.signalstats.${plane}AVG`).join(","),
    "-af",
    "silencedetect=n=-50dB:d=1,volumedetect",
    "-f",
    "null",
    "-",
  ];
}

interface Stretch {
  startMs: number;
  endMs: number;
}

/** What FFmpeg's report says of the file. */
export interface VideoReport {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  hasAudio: boolean;
  black: Stretch[];
  silence: Stretch[];
  meanDb: number | null;
  peakDb: number | null;
  /** Each frame's average colour, as video-range YUV (Y 16 black to 235 white), by its time. */
  frames: FrameColour[];
}

const ms = (seconds: string) => Math.round(Number(seconds) * 1000);

/** Reads FFmpeg's report of an analysis. Only the input's own streams count, not the output's. */
export function parseReport(report: string): VideoReport {
  const input = report.split(/\nOutput #0|\nStream mapping:/)[0] ?? report;
  const duration = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(input);
  const video = /Stream #\d+:\d+.*?: Video: .*?(\d{2,5})x(\d{2,5})/.exec(input);
  const fps = /Stream #\d+:\d+.*?: Video: .*?(\d+(?:\.\d+)?) fps/.exec(input);
  const black = [...report.matchAll(/black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)/g)].map(
    (match) => ({ startMs: ms(match[1]!), endMs: ms(match[2]!) }),
  );
  const durationMs = duration
    ? Math.round(
        (Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])) * 1000,
      )
    : null;
  // A silence still going at the end has a start and no end.
  const silence: Stretch[] = [];
  for (const match of report.matchAll(/silence_(start|end):\s*(-?[\d.]+)/g)) {
    if (match[1] === "start") silence.push({ startMs: Math.max(0, ms(match[2]!)), endMs: -1 });
    else if (silence.at(-1)?.endMs === -1) silence.at(-1)!.endMs = ms(match[2]!);
  }
  for (const stretch of silence) if (stretch.endMs === -1) stretch.endMs = durationMs ?? 0;
  const mean = /mean_volume:\s*(-?[\d.]+|-inf) dB/.exec(report);
  const peak = /max_volume:\s*(-?[\d.]+|-inf) dB/.exec(report);
  const db = (match: RegExpExecArray | null) =>
    !match ? null : match[1] === "-inf" ? -Infinity : Number(match[1]);
  return {
    durationMs,
    width: video ? Number(video[1]) : null,
    height: video ? Number(video[2]) : null,
    fps: fps ? Number(fps[1]) : null,
    hasAudio: /Stream #\d+:\d+.*?: Audio:/.test(input),
    black,
    silence,
    meanDb: db(mean),
    peakDb: db(peak),
    frames: frameColours(report),
  };
}

export interface FrameColour {
  ms: number;
  y: number;
  u: number;
  v: number;
}

/** Each frame's averages as the `metadata` filters print them, one key per filter. */
function frameColours(report: string): FrameColour[] {
  const byTime = new Map<string, Partial<FrameColour>>();
  for (const match of report.matchAll(
    /pts_time:([\d.]+)\s*\n[^\n]*?signalstats\.([YUV])AVG=([\d.]+)/g,
  )) {
    const frame = byTime.get(match[1]!) ?? { ms: ms(match[1]!) };
    frame[match[2]!.toLowerCase() as "y" | "u" | "v"] = Number(match[3]);
    byTime.set(match[1]!, frame);
  }
  return [...byTime.values()]
    .filter((frame): frame is FrameColour => frame.y !== undefined)
    .map((frame) => ({ ...frame, u: frame.u ?? 128, v: frame.v ?? 128 }))
    .sort((a, b) => a.ms - b.ms);
}

/** A frame's average as linear sRGB, 0 to 1 (BT.601, video range, as FFmpeg encodes it). */
function linearRgb({ y, u, v }: FrameColour): [number, number, number] {
  const c = y - 16;
  const d = u - 128;
  const e = v - 128;
  const linear = (value: number) => {
    const s = Math.min(1, Math.max(0, value / 255));
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [
    linear(1.164 * c + 1.596 * e),
    linear(1.164 * c - 0.392 * d - 0.813 * e),
    linear(1.164 * c + 2.017 * d),
  ];
}

/**
 * The times of a series' opposing changes: each change of `least` or more against the last
 * turning point, when `counts` says the two sides make a flash.
 */
function transitions(
  levels: { ms: number; level: number }[],
  least: number,
  counts: (a: number, b: number) => boolean,
): number[] {
  const changes: number[] = [];
  let turn = levels[0]?.level ?? 0;
  let rising = 0;
  for (const { ms: at, level } of levels) {
    if ((rising > 0 && level > turn) || (rising < 0 && level < turn)) turn = level;
    else if (Math.abs(level - turn) >= least && counts(level, turn)) {
      changes.push(at);
      rising = Math.sign(level - turn);
      turn = level;
    }
  }
  return changes;
}

/** The first one-second window holding more than `FLASHES_PER_SECOND` flashes. */
function tooMany(changes: number[]): Stretch | null {
  const most = (FLASHES_PER_SECOND + 1) * 2;
  for (let first = 0; first + most - 1 < changes.length; first += 1)
    if (changes[first + most - 1]! - changes[first]! < 1000)
      return { startMs: changes[first]!, endMs: changes[first + most - 1]! };
  return null;
}

/**
 * Where the picture flashes too often for learners prone to seizures, by the whole frame's
 * average colour, after WCAG 2.3.1's two thresholds:
 *
 * - general flashes: changes of `FLASH_CHANGE` or more in relative luminance, the darker side
 *   under `FLASH_DARK`;
 * - red flashes: changes of more than `RED_FLASH_CHANGE` in (R - G - B) × 320, from or to a
 *   saturated red (red at least `SATURATED_RED` of R + G + B).
 *
 * A frame's average misses a flash that covers only part of it, so passing is not proof;
 * failing is.
 */
export function flashing(frames: FrameColour[]): Stretch | null {
  const colours = frames.map((frame) => ({ ms: frame.ms, rgb: linearRgb(frame) }));
  const general = transitions(
    colours.map(({ ms: at, rgb: [r, g, b] }) => ({
      ms: at,
      level: 0.2126 * r + 0.7152 * g + 0.0722 * b,
    })),
    FLASH_CHANGE,
    (a, b) => Math.min(a, b) < FLASH_DARK,
  );
  // Red counts only while a frame is saturated red; any other frame is no red at all.
  const red = transitions(
    colours.map(({ ms: at, rgb: [r, g, b] }) => ({
      ms: at,
      level: r + g + b > 0 && r / (r + g + b) >= SATURATED_RED ? Math.max(0, r - g - b) * 320 : 0,
    })),
    RED_FLASH_CHANGE,
    () => true,
  );
  return tooMany(general) ?? tooMany(red);
}

/** How much of `stretch` the stretches in `over` cover, in milliseconds. */
function covered(stretch: Stretch, over: Stretch[]): number {
  return over.reduce(
    (sum, other) =>
      sum +
      Math.max(0, Math.min(stretch.endMs, other.endMs) - Math.max(stretch.startMs, other.startMs)),
    0,
  );
}

/** A loudness as a run keeps it: JSON has no -Infinity, so utter silence is kept as -999 dB. */
function storedDb(db: number | null): number | null {
  if (db === null) return null;
  return Number.isFinite(db) ? db : -999;
}

/** What a report says against what the video should be. */
export function judge(report: VideoReport, expected: VideoExpectation): VideoCheck {
  const findings: VideoCheckFinding[] = [];
  const measured = {
    durationMs: report.durationMs,
    width: report.width,
    height: report.height,
    fps: report.fps,
    hasAudio: report.hasAudio,
    meanDb: storedDb(report.meanDb),
    peakDb: storedDb(report.peakDb),
  };
  if (report.durationMs === null || report.width === null || report.height === null)
    return {
      status: "fail",
      ...measured,
      findings: [{ code: "unreadable", severity: "error" }],
    };
  const length = report.durationMs;
  const off = Math.abs(length - expected.durationMs);
  if (off > Math.max(DURATION_SLACK_MS, expected.durationMs * DURATION_TOLERANCE))
    findings.push({
      code: "duration_off",
      severity: off > expected.durationMs * DURATION_ERROR ? "error" : "warning",
    });
  if (report.width !== expected.width || report.height !== expected.height)
    findings.push({ code: "size_off", severity: "error" });
  if (expected.audio && !report.hasAudio)
    findings.push({ code: "audio_missing", severity: "error" });
  if (report.hasAudio) {
    if (report.meanDb !== null && report.meanDb < SILENT_MEAN_DB)
      findings.push({ code: "silent", severity: "error" });
    if (report.peakDb !== null && report.peakDb > CLIPPING_PEAK_DB)
      findings.push({ code: "clipping", severity: "warning" });
    for (const line of expected.narration) {
      const span = Math.min(line.endMs, length) - line.startMs;
      if (span > 0 && covered(line, report.silence) >= span * NARRATION_SILENT_SHARE)
        findings.push({
          code: "narration_silent",
          severity: "warning",
          asset: line.asset,
          startMs: line.startMs,
          endMs: line.endMs,
        });
    }
  }
  const blackMs = report.black.reduce((sum, stretch) => sum + stretch.endMs - stretch.startMs, 0);
  if (length > 0 && blackMs >= length * BLACK_ERROR_SHARE)
    findings.push({ code: "black", severity: "error", startMs: 0, endMs: length });
  else
    for (const stretch of report.black)
      findings.push({ code: "black", severity: "warning", ...stretch });
  const flash = flashing(report.frames);
  if (flash) findings.push({ code: "flashing", severity: "error", ...flash });
  return {
    status: findings.some((finding) => finding.severity === "error") ? "revise" : "pass",
    ...measured,
    findings,
  };
}

/** Analyses the video at `file` with FFmpeg and checks it against what it should be. */
export async function checkVideo(file: string, expected: VideoExpectation): Promise<VideoCheck> {
  const report = await ffmpegReport(checkArgs(file), {
    purpose: "to check a scene video",
    timeoutMs: CHECK_TIMEOUT_MS,
  });
  return judge(parseReport(report), expected);
}
