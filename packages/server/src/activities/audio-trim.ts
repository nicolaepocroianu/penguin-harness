/**
 * Trimming a speech clip, as Loom trims one: the author selects a stretch and it is cut out,
 * the audio either side joined, and the result kept as MP3 (libmp3lame, VBR quality 2, no
 * metadata), the format Loom writes. Everything here runs FFmpeg through ffmpeg.ts.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HttpError } from "../http/errors.js";
import { FfmpegError, runFfmpeg } from "./ffmpeg.js";
import { requireEnum, requireString } from "../http/validate.js";
import type { TrimRange, TrimSource } from "./audio-trim-types.js";

/** The shortest stretch a trim removes, as in Loom. */
export const TRIM_MIN_SECONDS = 0.05;
/** A trim must leave more than this much audio, as in Loom. */
export const TRIM_MIN_REMAINING_SECONDS = 0.001;
/** How long one trim, or one measurement, may take: Loom's two minutes. */
export const TRIM_TIMEOUT_MS = 120_000;

const PURPOSE = "to trim audio";

function rangeError(message: string): HttpError {
  return new HttpError(400, "trim_range_invalid", message);
}

/** The range a request asked for, checked for shape alone (see fitTrimRange). */
export function parseTrimRange(body: Record<string, unknown>): TrimRange {
  const { startSeconds, endSeconds } = body;
  if (
    typeof startSeconds !== "number" ||
    typeof endSeconds !== "number" ||
    !Number.isFinite(startSeconds) ||
    !Number.isFinite(endSeconds) ||
    startSeconds < 0
  )
    throw rangeError("Trim times must be finite, non-negative numbers of seconds.");
  if (endSeconds - startSeconds < TRIM_MIN_SECONDS)
    throw rangeError("The trim must end at least 0.05 seconds after it starts.");
  return { startSeconds, endSeconds };
}

/** The clip a trim preview request names, from its `source` and that source's fields. */
export function parseTrimSource(body: Record<string, unknown>): TrimSource {
  const kind = requireEnum(body, "source", ["bound", "run", "upload"] as const);
  if (kind === "bound")
    return {
      kind,
      language: requireString(body, "language", { minLen: 1, maxLen: 32 }),
      assetKey: requireString(body, "assetKey", { minLen: 1, maxLen: 256 }),
    };
  if (kind === "run")
    return { kind, runId: requireString(body, "runId", { minLen: 1, maxLen: 128 }) };
  return { kind, path: requireString(body, "path", { minLen: 1, maxLen: 1024 }) };
}

/**
 * The range as it applies to a clip `seconds` long: an end past the clip is the clip's end,
 * as Loom reads it, and a trim that starts past the end or would leave nothing is refused.
 */
export function fitTrimRange(range: TrimRange, seconds: number): TrimRange {
  const { startSeconds } = parseTrimRange({ ...range });
  if (startSeconds >= seconds) throw rangeError("The trim must start before the clip ends.");
  const endSeconds = Math.min(range.endSeconds, seconds);
  if (endSeconds - startSeconds < TRIM_MIN_SECONDS)
    throw rangeError("The trim must end at least 0.05 seconds after it starts.");
  if (seconds - (endSeconds - startSeconds) < TRIM_MIN_REMAINING_SECONDS)
    throw rangeError("A trim must leave some audio.");
  return { startSeconds, endSeconds };
}

/** The rate a clip is decoded at to be measured: one channel of 16-bit samples. */
const MEASURE_RATE = 48_000;

/**
 * How long a clip plays, measured by decoding all of it to samples and counting them (a
 * header's estimate is not always there for MP3). Null when FFmpeg could not read the bytes
 * as audio.
 */
export async function audioSeconds(bytes: Uint8Array): Promise<number | null> {
  let samples: Buffer;
  try {
    samples = await runFfmpeg(
      ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vn"].concat([
        "-ac",
        "1",
        "-ar",
        String(MEASURE_RATE),
        "-f",
        "s16le",
        "pipe:1",
      ]),
      { purpose: PURPOSE, timeoutMs: TRIM_TIMEOUT_MS, input: bytes },
    );
  } catch (error) {
    if (error instanceof FfmpegError) return null;
    throw error;
  }
  const seconds = samples.length / 2 / MEASURE_RATE;
  return seconds > 0 ? seconds : null;
}

/**
 * The FFmpeg arguments that cut `range` out of the clip on stdin and write MP3 to `output`.
 * Loom cuts with `aselect`, which keeps or drops whole decoded frames; `atrim` cuts at the
 * sample, so the two kept stretches are trimmed apart and joined. The MP3 goes to a file, not
 * a pipe, so the encoder can write the header that tells a player how long a VBR clip is.
 */
export function trimArguments(range: TrimRange, output: string): string[] {
  const start = range.startSeconds.toFixed(6);
  const end = range.endSeconds.toFixed(6);
  const graph =
    range.startSeconds > 0
      ? `asplit=2[head][tail];[head]atrim=end=${start},asetpts=N/SR/TB[a];` +
        `[tail]atrim=start=${end},asetpts=N/SR/TB[b];[a][b]concat=n=2:v=0:a=1`
      : `atrim=start=${end},asetpts=N/SR/TB`;
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    "pipe:0",
    "-vn",
    "-af",
    graph,
    "-map_metadata",
    "-1",
    "-codec:a",
    "libmp3lame",
    "-q:a",
    "2",
    "-f",
    "mp3",
    "-y",
    output,
  ];
}

/** The clip with `range` cut out, as MP3; empty when FFmpeg wrote nothing. */
export async function cutAudio(bytes: Uint8Array, range: TrimRange): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-trim-"));
  const output = path.join(dir, "trimmed.mp3");
  try {
    await runFfmpeg(trimArguments(range, output), {
      purpose: PURPOSE,
      timeoutMs: TRIM_TIMEOUT_MS,
      input: bytes,
    });
    return await fs.readFile(output).catch(() => Buffer.alloc(0));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Why a trim's FFmpeg run failed, as the routes report it. */
export function trimFailed(cause: string): HttpError {
  return new HttpError(502, "audio_trim_failed", `Trimming the audio failed: ${cause}`);
}

/**
 * The sidecar a trimmed clip keeps, as Loom's `_trimmed_metadata` writes it: the clip's own
 * sidecar, when it had one, with its file name and script brought up to date and the word
 * timings dropped, since they described the untrimmed recording. Everything else stays,
 * `generationFingerprint` included: a trim keeps the voice and script, so Loom must not
 * speak the line again over it. Without a sidecar it is Loom's sidecar of an upload. The
 * length is the trimmed clip's (Loom drops it; Penguin knows it).
 */
export function trimmedSidecar(
  existing: Record<string, unknown> | null,
  fileName: string,
  script: string,
  durationMs: number,
): Record<string, unknown> {
  const base: Record<string, unknown> = existing
    ? { ...existing }
    : { generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), model: "Uploaded" };
  delete base.wordTimings;
  return { ...base, fileName, text: script, durationMs };
}

/** A sidecar's fields, or null when there is none or it is not a JSON object. */
export async function readSidecarFields(file: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Puts each file's new bytes in place all at once, so a reader never sees a half-written
 * one: every file is written beside its target first, and only once all are written is
 * each renamed over its target. A failure before the renames leaves every target as it was.
 */
export async function replaceFiles(files: { file: string; bytes: Uint8Array }[]): Promise<void> {
  const suffix = `.trim-${randomBytes(6).toString("hex")}.tmp`;
  const written: string[] = [];
  try {
    for (const { file, bytes } of files) {
      await fs.writeFile(`${file}${suffix}`, bytes, { flag: "wx" });
      written.push(`${file}${suffix}`);
    }
  } catch (error) {
    await Promise.all(written.map((temp) => fs.rm(temp, { force: true })));
    throw error;
  }
  for (const { file } of files) await fs.rename(`${file}${suffix}`, file);
}
