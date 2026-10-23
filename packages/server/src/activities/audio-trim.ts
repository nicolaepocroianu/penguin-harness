/**
 * Trimming a speech clip, as Loom trims one: the author selects a stretch and it is cut out,
 * the audio either side joined, and the result kept as MP3 (libmp3lame, VBR quality 2, no
 * metadata), the format Loom writes. Everything here runs FFmpeg through ffmpeg.ts.
 *
 * A trim is previewed before it is saved. Previews live in WAF Harness's own data root, never in
 * the media repository, and only the newest of each card is kept, as Loom keeps one preview
 * per clip. Saving one either replaces the bound clip in place or attaches it as an upload.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HttpError } from "../http/errors.js";
import { requireEnum, requireString } from "../http/validate.js";
import { FfmpegError, runFfmpeg } from "./ffmpeg.js";
import type { TrimRange, TrimSource, TrimTarget } from "./audio-trim-types.js";

/** The shortest stretch a trim removes, as in Loom. */
export const TRIM_MIN_SECONDS = 0.05;
/** A trim must leave more than this much audio, as in Loom. */
export const TRIM_MIN_REMAINING_SECONDS = 0.001;
/** How long one trim, or one measurement, may take: Loom's two minutes. */
export const TRIM_TIMEOUT_MS = 120_000;
/** How long an unsaved preview is kept, at most. */
export const TRIM_PREVIEW_MAX_AGE_MS = 24 * 60 * 60 * 1000;

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

/** The card a trim request is for. */
export function parseTrimTarget(body: Record<string, unknown>): TrimTarget {
  return {
    language: requireString(body, "language", { minLen: 1, maxLen: 32 }),
    assetKey: requireString(body, "assetKey", { minLen: 1, maxLen: 256 }),
  };
}

/** The clip a trim preview request names, from its `source` and that source's fields. */
export function parseTrimSource(body: Record<string, unknown>): TrimSource {
  const kind = requireEnum(body, "source", ["bound", "run", "upload", "preview"] as const);
  if (kind === "bound") return { kind };
  if (kind === "run")
    return { kind, runId: requireString(body, "runId", { minLen: 1, maxLen: 128 }) };
  if (kind === "preview")
    return { kind, token: requireString(body, "token", { minLen: 1, maxLen: 64 }) };
  return { kind, path: requireString(body, "path", { minLen: 1, maxLen: 1024 }) };
}

/**
 * The range as it applies to a clip `seconds` long: an end past the clip is the clip's end,
 * as Loom reads it, and a trim that starts past the end or would leave nothing is refused.
 */
export function fitTrimRange(range: TrimRange, seconds: number): TrimRange {
  const { startSeconds } = range;
  if (startSeconds >= seconds) throw rangeError("The trim must start before the clip ends.");
  const endSeconds = Math.min(range.endSeconds, seconds);
  if (endSeconds - startSeconds < TRIM_MIN_SECONDS)
    throw rangeError("The trim must end at least 0.05 seconds after it starts.");
  if (seconds - (endSeconds - startSeconds) < TRIM_MIN_REMAINING_SECONDS)
    throw rangeError("A trim must leave some audio.");
  return { startSeconds, endSeconds };
}

/**
 * The rate a clip is decoded at to be measured: one 8-bit channel at 1 kHz, so each byte is a
 * millisecond and a half-hour clip is under 2 MB in memory.
 */
const MEASURE_RATE = 1000;

/**
 * How long a clip plays, measured by decoding all of it and counting the samples (a header's
 * estimate is not always there for MP3). Null when FFmpeg could not read the bytes as audio.
 */
export async function audioSeconds(bytes: Uint8Array): Promise<number | null> {
  let samples: Buffer;
  try {
    samples = await runFfmpeg(
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-vn",
        "-ac",
        "1",
        "-ar",
        String(MEASURE_RATE),
        "-f",
        "u8",
        "pipe:1",
      ],
      { purpose: PURPOSE, timeoutMs: TRIM_TIMEOUT_MS, input: bytes },
    );
  } catch (error) {
    if (error instanceof FfmpegError) return null;
    throw error;
  }
  const seconds = samples.length / MEASURE_RATE;
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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wafh-trim-"));
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
 * timings dropped, since they described the untrimmed recording (Loom aligns the words again;
 * WAF Harness has no aligner). Everything else stays, `generationFingerprint` included: a trim
 * keeps the voice and script, so Loom must not speak the line again over it. Without a
 * sidecar it is Loom's sidecar of an upload. The length is the trimmed clip's, as measured.
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

/** Files swapped into place, kept undoable until the change they belong to is written. */
export interface FileSwap {
  /** The change was written: the files it replaced or removed are gone for good. */
  commit(): Promise<void>;
  /** The change was not written: every file is put back as it was. */
  rollback(): Promise<void>;
}

/**
 * Puts each file's new bytes in place and takes `removes` away, undoably. Every new file is
 * written beside its target first; only then is each file there moved aside to a backup and
 * the new one renamed in. A failure on the way puts everything back, as `rollback` does later:
 * a reader never sees a half-written file, and until `commit` the old files are still there.
 */
export async function swapFiles(
  writes: { file: string; bytes: Uint8Array }[],
  removes: string[] = [],
): Promise<FileSwap> {
  const suffix = `.trim-${randomBytes(6).toString("hex")}`;
  const staged: string[] = [];
  const moved: { file: string; backup: string }[] = [];
  const placed: string[] = [];
  const undo = async () => {
    for (const file of placed.splice(0)) await fs.rm(file, { force: true });
    for (const { file, backup } of moved.splice(0)) await fs.rename(backup, file);
    for (const temp of staged.splice(0)) await fs.rm(temp, { force: true });
  };
  try {
    for (const { file, bytes } of writes) {
      await fs.writeFile(`${file}${suffix}.tmp`, bytes, { flag: "wx" });
      staged.push(`${file}${suffix}.tmp`);
    }
    for (const file of [...writes.map((write) => write.file), ...removes]) {
      const backup = `${file}${suffix}.bak`;
      const done = await fs.rename(file, backup).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      );
      if (done) moved.push({ file, backup });
    }
    for (const { file } of writes) {
      await fs.rename(`${file}${suffix}.tmp`, file);
      staged.splice(staged.indexOf(`${file}${suffix}.tmp`), 1);
      placed.push(file);
    }
  } catch (error) {
    await undo();
    throw error;
  }
  return {
    commit: async () => {
      for (const { backup } of moved.splice(0)) await fs.rm(backup, { force: true });
      placed.length = 0;
    },
    rollback: undo,
  };
}

/** What a preview records beside its clip. */
export interface TrimPreviewRecord {
  token: string;
  target: TrimTarget;
  durationMs: number;
  /**
   * The bound clip a chain of trims started from, by content: saving the preview replaces
   * that clip, and only while it is still the one bound.
   */
  origin?: { path: string; sha256: string };
  createdAt: string;
}

const TOKEN = /^[a-f0-9]{24}$/;

function previewMissing(): HttpError {
  return new HttpError(
    404,
    "trim_preview_missing",
    "This trim preview is gone. Trim the clip again.",
  );
}

/** One activity's trim previews, in WAF Harness's data root. */
export class TrimPreviews {
  constructor(readonly dir: string) {}

  private file(token: string, extension: "mp3" | "json"): string {
    if (!TOKEN.test(token)) throw previewMissing();
    return path.join(this.dir, `${token}.${extension}`);
  }

  /** Keeps a new preview, and drops the card's older ones and any past their age. */
  async store(
    bytes: Uint8Array,
    record: Omit<TrimPreviewRecord, "token" | "createdAt">,
  ): Promise<TrimPreviewRecord> {
    await fs.mkdir(this.dir, { recursive: true });
    const now = Date.now();
    for (const name of await fs.readdir(this.dir).catch(() => [] as string[])) {
      if (!name.endsWith(".json")) continue;
      const old = (await readSidecarFields(path.join(this.dir, name))) as TrimPreviewRecord | null;
      const sameCard =
        old?.target?.language === record.target.language &&
        old?.target?.assetKey === record.target.assetKey;
      const stale = !old || now - Date.parse(old.createdAt) > TRIM_PREVIEW_MAX_AGE_MS;
      if (sameCard || stale) await this.remove(name.slice(0, -".json".length));
    }
    const full: TrimPreviewRecord = {
      ...record,
      token: randomBytes(12).toString("hex"),
      createdAt: new Date(now).toISOString(),
    };
    await fs.writeFile(this.file(full.token, "mp3"), bytes, { flag: "wx" });
    await fs.writeFile(this.file(full.token, "json"), JSON.stringify(full), { flag: "wx" });
    return full;
  }

  async read(token: string): Promise<{ bytes: Buffer; record: TrimPreviewRecord }> {
    try {
      const record = JSON.parse(
        await fs.readFile(this.file(token, "json"), "utf8"),
      ) as TrimPreviewRecord;
      return { bytes: await fs.readFile(this.file(token, "mp3")), record };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw previewMissing();
    }
  }

  async remove(token: string): Promise<void> {
    if (!TOKEN.test(token)) return;
    await fs.rm(this.file(token, "mp3"), { force: true });
    await fs.rm(this.file(token, "json"), { force: true });
  }
}
