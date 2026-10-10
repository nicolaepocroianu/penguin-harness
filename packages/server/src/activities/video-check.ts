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
    `blackdetect=d=${BLACK_MIN_SECONDS}:pix_th=0.10,signalstats,metadata=print:key=lavfi.signalstats.YAVG`,
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
  /** Each frame's average brightness (video range, 16 black to 235 white), by its time. */
  luma: { ms: number; y: number }[];
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
    luma: [...report.matchAll(/pts_time:([\d.]+)\s*\n[^\n]*?signalstats\.YAVG=([\d.]+)/g)].map(
      (match) => ({ ms: ms(match[1]!), y: Number(match[2]) }),
    ),
  };
}

/**
 * Where the picture flashes too often for learners prone to seizures, by the whole frame's
 * brightness: each change of `FLASH_CHANGE` or more against the last turning point, and the
 * first one-second window holding more than `FLASHES_PER_SECOND` flashes. A frame's average
 * misses a flash that covers only part of it, so passing is not proof; failing is.
 */
export function flashing(luma: VideoReport["luma"]): Stretch | null {
  const relative = (y: number) => Math.min(1, Math.max(0, (y - 16) / 219)) ** 2.2;
  const changes: number[] = [];
  let turn = luma[0] ? relative(luma[0].y) : 0;
  let rising = 0;
  for (const frame of luma) {
    const level = relative(frame.y);
    if ((rising > 0 && level > turn) || (rising < 0 && level < turn)) turn = level;
    else if (Math.abs(level - turn) >= FLASH_CHANGE && Math.min(level, turn) < FLASH_DARK) {
      changes.push(frame.ms);
      rising = Math.sign(level - turn);
      turn = level;
    }
  }
  const most = (FLASHES_PER_SECOND + 1) * 2;
  for (let first = 0; first + most - 1 < changes.length; first += 1)
    if (changes[first + most - 1]! - changes[first]! < 1000)
      return { startMs: changes[first]!, endMs: changes[first + most - 1]! };
  return null;
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
  const flash = flashing(report.luma);
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
