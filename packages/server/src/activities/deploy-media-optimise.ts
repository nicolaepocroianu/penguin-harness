/**
 * Shrinking the media a QA deploy ships, as Loom's deploy did (waf-loom
 * `backend/app/services/deploy/deploy_media_optimizer.py`, with the media repository's own
 * `scripts/fix_videos_for_validator.sh --brand-fix-only` for the MP4 brands).
 *
 * Each file the data names that the media clone's working tree has is looked at with FFmpeg:
 *
 *   .mp3                 kept when it already is one MP3 stream, mono, 44.1 kHz, at most
 *                        64 kb/s (5% over allowed), with no ID3v2 tag and no Xing/Info header;
 *                        otherwise re-encoded to that with LAME at 64 kb/s
 *   .mp4, .m4v, .mov     kept when it already is one H.264 yuv420p stream at no more than
 *                        30000/1001 fps and 1000 kb/s (5% over allowed), its index before its
 *                        data (fast start), and at most one audio stream, AAC mono 44.1 kHz at
 *                        64 kb/s or less; otherwise re-encoded to that (1000 kb/s average,
 *                        1500 kb/s peak, 3000 kb buffer, frame rate brought down to 30000/1001
 *                        only when it is above it). An .mp4 also gets the brands the media
 *                        repository's validator asks for: major brand mp42, compatible brands
 *                        mp42 iso2 avc1 mp41, encoded by Waterford Media Framework.
 *
 * An .mp4 already as above whose brands are not those gets them without being re-encoded: FFmpeg
 * copies its streams into a new file, as the brand fix does. Anything else is left alone, as is
 * a file the working tree does not have (the partial clone has it only in git's trees, already
 * as the repository keeps it). A file already as above is never encoded again, so a second
 * deploy re-encodes nothing it re-encoded before.
 *
 * A file that is only a Git LFS pointer (its content never downloaded into the clone) fails, as
 * it did in Loom, where ffprobe could not read it: what the repository holds for it cannot be
 * checked, nor shipped from here.
 *
 * FFmpeg writes only into `workDir`, a folder of the stage's own outside the clone; its output
 * replaces the clone's file only once it finished well, as a new file renamed into place, and
 * only while the clone's file is still the one FFmpeg read (an accepted take may be written into
 * the clone meanwhile, and is never overwritten), so a failed encode leaves the original as it
 * was. FFmpeg is a port: the stage runs it with none of this server's environment and, while
 * activity agents are confined, through the session sandbox, writable in `workDir` alone; a
 * test answers it with a fake.
 */
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { DeployProcessResult } from "./deploy-process.js";
import { withinRoot } from "./sandbox-paths.js";

export const AUDIO_BITRATE = "64k";
const AUDIO_BITRATE_LIMIT = 64_000 * 1.05;
export const VIDEO_BITRATE = "1000k";
const VIDEO_BITRATE_LIMIT = 1_000_000 * 1.05;
export const VIDEO_MAXRATE = "1500k";
export const VIDEO_BUFSIZE = "3000k";
export const TARGET_FPS = "30000/1001";
const TARGET_FPS_LIMIT = 30_000 / 1001;
/** How much of a video's start is searched for its index (`moov`) and data (`mdat`). */
const HEADER_SCAN_BYTES = 1024 * 1024;
/** How much of an MP3's start is searched for a Xing or Info header. */
const XING_SCAN_BYTES = 4096;
/** How much of what FFmpeg writes is kept: its description of a file is in the first of it. */
const OUTPUT_KEPT = 64 * 1024;
/** How much of it a failure's reason keeps, from its end. */
const REASON_MAX = 2000;
/** The largest `ftyp` box the brands are written into; FFmpeg's has a few dozen bytes. */
const FTYP_MAX = 4096;
/** How a Git LFS pointer file starts, and how large one is at most. */
const LFS_POINTER = "version https://git-lfs.github.com/spec/v1";
const LFS_POINTER_MAX = 1024;

/** The brands the media repository's validator asks an .mp4 for, in its order. */
export const MP4_MAJOR_BRAND = "mp42";
export const MP4_COMPATIBLE_BRANDS = ["mp42", "iso2", "avc1", "mp41"] as const;
export const MP4_ENCODED_BY = "Waterford Media Framework";

const AUDIO_EXTENSIONS = new Set([".mp3"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".m4v", ".mov"]);

export type MediaKind = "audio" | "video";

export type MediaOptimiseStatus =
  /** Re-encoded, and the clone's file replaced. */
  | "optimised"
  /** Already as the deploy ships it apart from an .mp4's brands, which it was given. */
  | "rebranded"
  /** Already as the deploy ships it: left as it is. */
  | "already_optimised"
  /** Not audio or video the deploy re-encodes (an image, a font). */
  | "skipped_other"
  /** Not in the working tree: the repository has it only in git's trees. */
  | "skipped_not_local"
  /** It could not be re-encoded (see `MediaProblem`): the original is as it was. */
  | "failed";

/** Why a file failed. */
export type MediaProblem =
  /** FFmpeg could not read it or re-encode it. */
  | "ffmpeg"
  /** The clone has only its Git LFS pointer, not its content. */
  | "lfs_pointer"
  /** It changed in the clone while FFmpeg re-encoded it. */
  | "changed"
  /** The re-encoded copy could not be put in its place: the reason names the OS error. */
  | "write";

export interface MediaOptimisedFile {
  /** The file, as a path in the media repository. */
  path: string;
  kind: MediaKind | "other";
  status: MediaOptimiseStatus;
  /** Its size before, and after when it was re-encoded. */
  bytesBefore?: number;
  bytesAfter?: number;
  /** Why it failed. */
  problem?: MediaProblem;
  reason?: string;
}

export interface MediaOptimiseReport {
  files: MediaOptimisedFile[];
  optimised: number;
  rebranded: number;
  alreadyOptimised: number;
  skipped: number;
  failed: number;
  /** What the re-encoded and rebranded files weighed before, and weigh now. */
  bytesBefore: number;
  bytesAfter: number;
}

export interface MediaOptimiseInput {
  /** The media clone. */
  dir: string;
  /** An empty folder outside the clone, the only place FFmpeg writes. */
  workDir: string;
  /** The files to look at, as paths in the media repository. */
  paths: readonly string[];
}

export interface MediaOptimisePorts {
  /** Runs FFmpeg with `args`, handing what it writes to `onOutput`. Never throws. */
  ffmpeg(args: string[], onOutput: (text: string) => void): Promise<DeployProcessResult>;
  log(text: string): void;
}

/** FFmpeg could not be started at all: nothing was re-encoded. */
export class FfmpegUnavailable extends Error {
  constructor(readonly detail: string) {
    super(`ffmpeg could not be run: ${detail}`);
    this.name = "FfmpegUnavailable";
  }
}

/** The engineer pressed Stop while FFmpeg ran. */
export class FfmpegStopped extends Error {
  constructor() {
    super("stopped");
    this.name = "FfmpegStopped";
  }
}

export async function optimiseMedia(
  input: MediaOptimiseInput,
  ports: MediaOptimisePorts,
): Promise<MediaOptimiseReport> {
  const files: MediaOptimisedFile[] = [];
  let index = 0;
  for (const file of new Set(input.paths)) {
    const result = await optimiseOne(input, ports, file, index++);
    files.push(result);
    if (result.status === "optimised")
      ports.log(
        `Optimised ${file}: ${sizeText(result.bytesBefore!)} → ${sizeText(result.bytesAfter!)} (${savingText(result.bytesBefore!, result.bytesAfter!)}).`,
      );
    else if (result.status === "rebranded") ports.log(`Gave ${file} the validator's MP4 brands.`);
    else if (result.status === "failed")
      ports.log(`Could not optimise ${file}: ${result.reason ?? "ffmpeg failed."}`);
  }
  const report = summarise(files);
  ports.log(
    `Media optimisation: ${report.optimised} re-encoded, ${report.rebranded ? `${report.rebranded} given MP4 brands, ` : ""}${report.alreadyOptimised} already optimised, ${report.skipped} skipped, ${report.failed} failed.` +
      (report.optimised || report.rebranded
        ? ` ${sizeText(report.bytesBefore)} → ${sizeText(report.bytesAfter)} (${savingText(report.bytesBefore, report.bytesAfter)}).`
        : ""),
  );
  return report;
}

function summarise(files: MediaOptimisedFile[]): MediaOptimiseReport {
  const report: MediaOptimiseReport = {
    files,
    optimised: 0,
    rebranded: 0,
    alreadyOptimised: 0,
    skipped: 0,
    failed: 0,
    bytesBefore: 0,
    bytesAfter: 0,
  };
  for (const file of files) {
    if (file.status === "optimised" || file.status === "rebranded") {
      if (file.status === "optimised") report.optimised++;
      else report.rebranded++;
      report.bytesBefore += file.bytesBefore ?? 0;
      report.bytesAfter += file.bytesAfter ?? 0;
    } else if (file.status === "already_optimised") report.alreadyOptimised++;
    else if (file.status === "failed") report.failed++;
    else report.skipped++;
  }
  return report;
}

export function kindOf(file: string): MediaKind | null {
  const ext = path.extname(file).toLowerCase();
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  return null;
}

async function optimiseOne(
  input: MediaOptimiseInput,
  ports: MediaOptimisePorts,
  file: string,
  index: number,
): Promise<MediaOptimisedFile> {
  const kind = kindOf(file);
  if (!kind) return { path: file, kind: "other", status: "skipped_other" };
  const source = withinRoot(input.dir, file);
  // A link is never followed: only a file of the working tree's own is re-encoded.
  const stat = source ? await fs.lstat(source).catch(() => null) : null;
  if (!source || !stat?.isFile()) return { path: file, kind, status: "skipped_not_local" };
  const failed = (problem: MediaProblem, reason: string): MediaOptimisedFile => ({
    path: file,
    kind,
    status: "failed",
    bytesBefore: stat.size,
    problem,
    reason,
  });

  const header = await readHead(source, kind === "audio" ? XING_SCAN_BYTES : HEADER_SCAN_BYTES);
  if (stat.size <= LFS_POINTER_MAX && header.toString("latin1").startsWith(LFS_POINTER))
    return failed("lfs_pointer", "The media clone has only its Git LFS pointer, not the file.");
  const probed = await run(ports, ["-hide_banner", "-nostdin", "-nostats", "-i", source]);
  // With no output named FFmpeg exits 1 after describing the input; it read the file when it
  // described it.
  if (!/^Input #0/m.test(probed.output))
    return failed("ffmpeg", probed.reason || "ffmpeg could not read the file.");
  const probe = parseProbe(probed.output);
  const ext = path.extname(file).toLowerCase();
  const optimised =
    kind === "audio" ? audioIsOptimised(probe, header) : videoIsOptimised(probe, header);
  const branded = ext !== ".mp4" || brandsOk(header);
  if (optimised && branded) return { path: file, kind, status: "already_optimised" };

  const output = path.join(input.workDir, `${index}${ext}`);
  try {
    // An .mp4 wanting only its brands has its streams copied, never encoded again.
    let args: string[];
    if (optimised) args = rebrandArgs(source, output);
    else if (kind === "audio") args = audioArgs(source, output);
    else args = videoArgs(source, output, probe, ext);
    const encoded = await run(ports, args);
    if (encoded.result.error === "timed_out")
      return failed("ffmpeg", "ffmpeg took longer than its time limit and was stopped.");
    if (encoded.result.code !== 0)
      return failed("ffmpeg", encoded.reason || `ffmpeg exited with ${encoded.result.code}.`);
    const written = await fs.lstat(output).catch(() => null);
    if (!written?.isFile() || written.size === 0)
      return failed("ffmpeg", "ffmpeg finished without writing the file.");
    if (ext === ".mp4") {
      const unbranded = await patchBrands(output);
      if (unbranded) return failed("ffmpeg", unbranded);
    }
    const unreplaced = await replaceInClone(input.dir, source, output, stat);
    if (unreplaced) return failed(unreplaced.problem, unreplaced.reason);
    const after = (await fs.stat(source)).size;
    return {
      path: file,
      kind,
      status: optimised ? "rebranded" : "optimised",
      bytesBefore: stat.size,
      bytesAfter: after,
    };
  } catch (error) {
    if (error instanceof FfmpegUnavailable || error instanceof FfmpegStopped) throw error;
    return failed("write", osError(error));
  } finally {
    await fs.rm(output, { force: true });
  }
}

/**
 * Runs FFmpeg once, keeping the first `OUTPUT_KEPT` characters of what it writes, where its
 * description of a file is, and the last `REASON_MAX`, where why it failed is. A missing FFmpeg
 * and Stop end the whole pass.
 */
async function run(ports: MediaOptimisePorts, args: string[]) {
  let output = "";
  let end = "";
  let heard = false;
  const result = await ports.ffmpeg(args, (text) => {
    heard = true;
    if (output.length < OUTPUT_KEPT) output += text.slice(0, OUTPUT_KEPT - output.length);
    end = (end + text).slice(-REASON_MAX * 2);
  });
  if (result.error === "not_found" || result.error === "not_started")
    throw new FfmpegUnavailable(tailOf(result.tail) || "it is not installed.");
  if (result.error === "stopped") throw new FfmpegStopped();
  if (!heard) output = result.tail;
  return { result, output: output.slice(0, OUTPUT_KEPT), reason: tailOf(heard ? end : output) };
}

/** What FFmpeg says before an output: no banner, no progress, only errors. */
const QUIET = ["-hide_banner", "-nostdin", "-nostats", "-loglevel", "error", "-y"];

/**
 * An .mp4 with its streams as they are and the validator's brands, as the media repository's
 * brand fix writes it (`validator_fix_brands_inplace`).
 */
export function rebrandArgs(source: string, output: string): string[] {
  return [
    ...QUIET,
    "-i",
    source,
    "-map",
    "0",
    "-c",
    "copy",
    "-movflags",
    "+faststart+use_metadata_tags",
    "-metadata",
    `compatible_brands=${MP4_COMPATIBLE_BRANDS.join("")}`,
    "-metadata",
    `encoded_by=${MP4_ENCODED_BY}`,
    output,
  ];
}

export function audioArgs(source: string, output: string): string[] {
  return [
    ...QUIET,
    "-i",
    source,
    "-map",
    "0:a:0",
    "-vn",
    "-sn",
    "-dn",
    "-ac",
    "1",
    "-ar",
    "44100",
    "-c:a",
    "libmp3lame",
    "-b:a",
    AUDIO_BITRATE,
    "-write_xing",
    "0",
    "-id3v2_version",
    "0",
    output,
  ];
}

export function videoArgs(
  source: string,
  output: string,
  probe: MediaProbe,
  ext: string,
): string[] {
  const video = probe.streams.find((stream) => stream.type === "video");
  return [
    ...QUIET,
    "-i",
    source,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-dn",
    "-sn",
    ...((video?.fps ?? 0) > TARGET_FPS_LIMIT ? ["-vf", `fps=${TARGET_FPS}`] : []),
    "-c:v",
    "libx264",
    "-b:v",
    VIDEO_BITRATE,
    "-maxrate",
    VIDEO_MAXRATE,
    "-bufsize",
    VIDEO_BUFSIZE,
    "-pix_fmt",
    "yuv420p",
    // The brands are the validator's: what its brand fix writes, as one pass.
    ...(ext === ".mp4"
      ? [
          "-movflags",
          "+faststart+use_metadata_tags",
          "-metadata",
          `compatible_brands=${MP4_COMPATIBLE_BRANDS.join("")}`,
          "-metadata",
          `encoded_by=${MP4_ENCODED_BY}`,
        ]
      : ["-movflags", "+faststart"]),
    "-c:a",
    "aac",
    "-b:a",
    AUDIO_BITRATE,
    "-ac",
    "1",
    "-ar",
    "44100",
    output,
  ];
}

/** One input stream as FFmpeg describes it. */
export interface MediaStream {
  type: string;
  codec: string;
  /** Video only. */
  pixelFormat?: string;
  fps?: number;
  /** Audio only. */
  channels?: number;
  sampleRate?: number;
  /** In bits a second; absent when FFmpeg gave none. */
  bitRate?: number;
}

export interface MediaProbe {
  streams: MediaStream[];
  /** The whole file's, in bits a second. */
  bitRate?: number;
}

/**
 * Reads FFmpeg's description of its first input (`ffmpeg -i`), which the bundled FFmpeg gives
 * where Loom asked ffprobe: each `Stream #0:n` line's kind, codec, and the fields after it.
 */
export function parseProbe(text: string): MediaProbe {
  const input = text.split(/\r?\n(?=Input #[1-9]|Output #0|Stream mapping:)/)[0] ?? text;
  const total = /^\s*Duration:.*?bitrate: (\d+(?:\.\d+)?) kb\/s/m.exec(input);
  const streams: MediaStream[] = [];
  for (const match of input.matchAll(/^\s*Stream #0:\d+\S*: (\w+): (.*)$/gm)) {
    const type = match[1]!.toLowerCase();
    const fields = topLevelFields(match[2]!);
    const stream: MediaStream = { type, codec: /^[\w-]+/.exec(fields[0] ?? "")?.[0] ?? "" };
    const rest = fields.slice(1).join(", ");
    const bitRate = /(\d+(?:\.\d+)?) kb\/s/.exec(rest);
    if (bitRate) stream.bitRate = Number(bitRate[1]) * 1000;
    if (type === "video") {
      stream.pixelFormat = /^[\w]+/.exec(fields[1] ?? "")?.[0] ?? "";
      const fps = /(\d+(?:\.\d+)?)(k?) fps/.exec(rest) ?? /(\d+(?:\.\d+)?)(k?) tbr/.exec(rest);
      if (fps) stream.fps = Number(fps[1]) * (fps[2] ? 1000 : 1);
    } else if (type === "audio") {
      const rate = /(\d+) Hz/.exec(rest);
      if (rate) stream.sampleRate = Number(rate[1]);
      stream.channels = channelsOf(fields[2] ?? "");
    }
    streams.push(stream);
  }
  return { streams, ...(total ? { bitRate: Number(total[1]) * 1000 } : {}) };
}

/** A description split at its commas, leaving the commas inside brackets alone. */
function topLevelFields(text: string): string[] {
  const fields: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "[") depth++;
    else if ((c === ")" || c === "]") && depth > 0) depth--;
    else if (c === "," && depth === 0) {
      fields.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  fields.push(text.slice(start).trim());
  return fields;
}

/** FFmpeg's word for a channel layout, as a count. */
function channelsOf(layout: string): number {
  const word = layout.trim().split(/[\s(]/)[0] ?? "";
  if (word === "mono") return 1;
  if (word === "stereo") return 2;
  const count = /^(\d+) channels/.exec(layout.trim());
  if (count) return Number(count[1]);
  const surround = /^(\d+)\.(\d+)/.exec(word);
  return surround ? Number(surround[1]) + Number(surround[2]) : 0;
}

function streamBitRate(stream: MediaStream, probe: MediaProbe, fallback: boolean): number {
  if (stream.bitRate) return stream.bitRate;
  return fallback ? (probe.bitRate ?? 0) : 0;
}

export function audioIsOptimised(probe: MediaProbe, header: Buffer): boolean {
  const audio = probe.streams.filter((stream) => stream.type === "audio");
  if (audio.length !== 1 || audio.length !== probe.streams.length) return false;
  const stream = audio[0]!;
  return (
    stream.codec === "mp3" &&
    stream.channels === 1 &&
    stream.sampleRate === 44_100 &&
    streamBitRate(stream, probe, true) <= AUDIO_BITRATE_LIMIT &&
    header.subarray(0, 3).toString("latin1") !== "ID3" &&
    !header.includes("Xing", 0, "latin1") &&
    !header.includes("Info", 0, "latin1")
  );
}

export function videoIsOptimised(probe: MediaProbe, header: Buffer): boolean {
  const video = probe.streams.filter((stream) => stream.type === "video");
  const audio = probe.streams.filter((stream) => stream.type === "audio");
  if (video.length !== 1 || audio.length > 1) return false;
  if (video.length + audio.length !== probe.streams.length) return false;
  const stream = video[0]!;
  if (
    stream.codec !== "h264" ||
    stream.pixelFormat !== "yuv420p" ||
    (stream.fps ?? 0) > TARGET_FPS_LIMIT ||
    streamBitRate(stream, probe, false) > VIDEO_BITRATE_LIMIT ||
    !fastStart(header)
  )
    return false;
  const sound = audio[0];
  if (!sound) return true;
  return (
    sound.codec === "aac" &&
    sound.channels === 1 &&
    sound.sampleRate === 44_100 &&
    streamBitRate(sound, probe, true) <= AUDIO_BITRATE_LIMIT
  );
}

/**
 * Whether an .mp4's `ftyp` box already holds the validator's brands: major brand mp42 and the
 * compatible brands in its order, empty slots aside (`needs_brand_fix`).
 */
export function brandsOk(header: Buffer): boolean {
  if (header.length < 16 || header.subarray(4, 8).toString("latin1") !== "ftyp") return false;
  const size = header.readUInt32BE(0);
  if (size < 16 || size > header.length) return false;
  if (header.subarray(8, 12).toString("latin1") !== MP4_MAJOR_BRAND) return false;
  const brands: string[] = [];
  for (let at = 16; at + 4 <= size; at += 4) {
    const brand = header
      .subarray(at, at + 4)
      .toString("latin1")
      .replace(/\0/g, "");
    if (brand) brands.push(brand);
  }
  return brands.join(" ") === MP4_COMPATIBLE_BRANDS.join(" ");
}

/** Whether a video's index comes before its data in the start of the file. */
function fastStart(header: Buffer): boolean {
  const moov = header.indexOf("moov", 0, "latin1");
  if (moov < 0) return false;
  const mdat = header.indexOf("mdat", 0, "latin1");
  return mdat < 0 || moov < mdat;
}

async function readHead(file: string, bytes: number): Promise<Buffer> {
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Writes the validator's brands into an .mp4's `ftyp` box in place, as the media repository's
 * brand fix does without MP4Box: major brand first, then the compatible brands in order, any
 * slot left over zeroed. Answers why it could not, or null.
 */
export async function patchBrands(file: string): Promise<string | null> {
  const handle = await fs.open(file, "r+");
  try {
    const head = Buffer.alloc(8);
    await handle.read(head, 0, 8, 0);
    if (head.subarray(4, 8).toString("latin1") !== "ftyp")
      return "The re-encoded video has no ftyp box at its start.";
    const size = head.readUInt32BE(0);
    const { size: fileSize } = await handle.stat();
    if (size < 16 || size > Math.min(fileSize, FTYP_MAX))
      return `The re-encoded video's ftyp box says it is ${size} bytes, which cannot be right.`;
    const slots = Math.floor((size - 16) / 4);
    if (slots < MP4_COMPATIBLE_BRANDS.length)
      return `The re-encoded video's ftyp box has ${Math.max(slots, 0)} compatible brand slots; ${MP4_COMPATIBLE_BRANDS.length} are needed.`;
    const brands = Buffer.alloc(slots * 4);
    MP4_COMPATIBLE_BRANDS.forEach((brand, i) => brands.write(brand, i * 4, "latin1"));
    await handle.write(Buffer.from(MP4_MAJOR_BRAND, "latin1"), 0, 4, 8);
    await handle.write(brands, 0, brands.length, 16);
    return null;
  } finally {
    await handle.close();
  }
}

/**
 * Puts `from` in place of the clone's `target` as a new file renamed into place, so a link is
 * replaced rather than written through, and only into a folder that really is in the clone.
 * Nothing is replaced when `target` is no longer as `read` found it: something wrote it while
 * FFmpeg ran. Answers why it was not replaced, or null.
 */
async function replaceInClone(
  root: string,
  target: string,
  from: string,
  read: { size: number; mtimeMs: number },
): Promise<{ problem: MediaProblem; reason: string } | null> {
  const [realRoot, realFolder] = await Promise.all([
    fs.realpath(root),
    fs.realpath(path.dirname(target)),
  ]);
  const rel = path.relative(realRoot, realFolder);
  if (rel.startsWith("..") || path.isAbsolute(rel))
    throw new Error(`${target} is not inside the media clone.`);
  const changed = () =>
    fs.lstat(target).then(
      (now) => !now.isFile() || now.size !== read.size || now.mtimeMs !== read.mtimeMs,
      () => true,
    );
  const unchanged = {
    problem: "changed" as const,
    reason:
      "It changed in the media clone while it was re-encoded (a take accepted meanwhile?), so it was left as it now is. Deploy again to re-encode it.",
  };
  if (await changed()) return unchanged;
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    await fs.copyFile(from, temp, fsConstants.COPYFILE_EXCL);
    if (await changed()) {
      await fs.rm(temp, { force: true });
      return unchanged;
    }
    await renameRetrying(temp, target);
    return null;
  } catch (error) {
    await fs.rm(temp, { force: true });
    return { problem: "write", reason: osError(error) };
  }
}

/** A rename, tried once more shortly after when Windows says the file is busy. */
async function renameRetrying(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EBUSY" && code !== "EPERM") throw error;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await fs.rename(from, to);
  }
}

/** An OS error as one line: its code and message. */
function osError(error: unknown): string {
  const { code, message } = error as NodeJS.ErrnoException;
  return code && !message.startsWith(code) ? `${code}: ${message}` : message;
}

/** The end of what FFmpeg wrote: its last lines, a progress line's carriage returns as breaks. */
function tailOf(text: string): string {
  const tail = text
    .trim()
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim() !== "")
    .slice(-20)
    .join("\n");
  return tail.length > REASON_MAX ? `…${tail.slice(-REASON_MAX)}` : tail;
}

/** A size as people read it. */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** What re-encoding saved, or that it grew. */
export function savingText(before: number, after: number): string {
  const saved = before - after;
  const percent = before > 0 ? Math.round((Math.abs(saved) / before) * 100) : 0;
  return saved >= 0
    ? `saved ${sizeText(saved)}, ${percent}%`
    : `grew by ${sizeText(-saved)}, ${percent}%`;
}
