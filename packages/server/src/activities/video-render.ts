/**
 * Rendering a scene composition to a video (experimental, behind `activityVideoExperiment`).
 *
 * The composition (see composition.ts) is opened once in the test browser (see
 * browser-session.ts) at its canvas size. Once its bridge says it is ready, its paused
 * timeline is stepped through frame by frame: seek to the frame's time, let the page paint,
 * take a screenshot. The screenshots are piped to FFmpeg (see ffmpeg.ts), which encodes them
 * as an H.264 MP4 at a fixed frame rate. Nothing plays in real time, so the video has no
 * blank lead-in, every frame is the timeline's own, and a slow machine renders slower rather
 * than dropping frames.
 *
 * The seek-and-capture loop and the encode follow open-design's deterministic frame renderer
 * (apps/desktop/src/main/frame-capture.ts and `encodeHyperFramesMp4` in
 * apps/daemon/src/media/index.ts, Apache-2.0), moved from Electron to Playwright and to
 * Penguin's `window.__composition` bridge.
 *
 * Recordings made before this renderer are WebM files from Playwright's page recorder; they
 * are still read and checked here (`inspectWebm`).
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { openPage, type BrowserLauncher } from "./browser-session.js";
import { FfmpegError, startFfmpeg, type FfmpegRun } from "./ffmpeg.js";
import { AUDIT_SCRIPT, auditFrames, layoutFindings } from "./layout-audit.js";
import type { VideoCheckFinding, VideoFormat, VideoProblemCode } from "./video-types.js";

/** How long the browser may take to start and the composition to load, and each page action. */
export const RENDER_PAGE_TIMEOUT_MS = 30_000;
/** The longest a whole render may take, capture and encode together. */
export const RENDER_MAX_MS = 10 * 60_000;
/** Frames per second of a rendered video. */
export const RENDER_FPS = 30;
/** The longest composition rendered (composition.ts allows 60 s), with some slack. */
export const RENDER_MAX_SECONDS = 65;
/** The largest recording kept. */
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
/** The file a render writes in its directory. */
export const RENDER_FILE = "render.mp4";

/** Waits for the bridge's promise and answers the length the page says it plays for. */
const READY_SCRIPT =
  "Promise.resolve(window.__composition && window.__composition.ready).then(function () {" +
  " var c = window.__composition; return c && typeof c.duration === 'number' ? c.duration : 0; })";

/** Pauses the timeline at its start; false when the page has no timeline to seek. */
const PREPARE_SCRIPT =
  "(function () { var c = window.__composition; var t = c && c.timeline;" +
  " if (!t || typeof t.pause !== 'function' || typeof t.seek !== 'function') return false;" +
  " t.pause(); t.seek(0, false); return true; })()";

/**
 * Seeks the timeline to `time` (callbacks on the way fire, as they would in playback) and
 * resolves once the page has painted it: two animation frames, or 100 ms when the page is not
 * painting at all.
 */
export function seekScript(time: number): string {
  return (
    `(function () { window.__composition.timeline.seek(${JSON.stringify(time)}, false);` +
    " return new Promise(function (resolve) { var done = false;" +
    " function finish() { if (!done) { done = true; resolve(true); } }" +
    " setTimeout(finish, 100);" +
    " requestAnimationFrame(function () { requestAnimationFrame(finish); }); }); })()"
  );
}

/** Starts the encoder: FFmpeg with these arguments, PNG frames written to its stdin. */
export type EncoderStarter = (args: string[], timeoutMs: number) => Promise<FfmpegRun>;

const ffmpegEncoder: EncoderStarter = (args, timeoutMs) =>
  startFfmpeg(args, { purpose: "to render a scene video", timeoutMs });

/** FFmpeg's arguments for PNG frames on stdin at `fps` to an H.264 MP4 at `file`. */
export function encodeArgs(fps: number, file: string): string[] {
  return [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "image2pipe",
    "-framerate",
    String(fps),
    "-c:v",
    "png",
    "-i",
    "pipe:0",
    // H.264 in yuv420p needs even dimensions.
    "-vf",
    "pad=ceil(iw/2)*2:ceil(ih/2)*2",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-an",
    file,
  ];
}

export interface RenderRequest {
  executablePath: string;
  /** The composition page, on a link the test browser on this machine can open. */
  compositionUrl: string;
  width: number;
  height: number;
  /** How long the composition was checked to play, used when the page says nothing. */
  seconds: number;
  /** Where the render writes; the caller's to remove. */
  dir: string;
  launcher?: BrowserLauncher;
  /** Starts FFmpeg; the real one unless a test stands in. */
  encoder?: EncoderStarter;
  /** How long each page step may take; `RENDER_PAGE_TIMEOUT_MS` unless a test shortens it. */
  pageTimeoutMs?: number;
  /** Frames per second; `RENDER_FPS` unless a test lowers it. */
  fps?: number;
}

/** Why a recording did not come out, with the code the App words it by when Penguin knows it. */
export class RenderError extends Error {
  constructor(
    message: string,
    readonly code: VideoProblemCode | null = null,
  ) {
    super(message);
  }
}

/**
 * Bounds a page step. `page.evaluate` does not honour the page's default timeout, and the page is
 * agent-written: a `ready` promise that never settles, or a page that blocks its main thread,
 * would otherwise hold the render (and its browser) forever.
 */
function within<T>(work: Promise<T>, ms: number, error: () => Error): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(error()), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** How many frames a composition of this length renders to: at least one, bounded. */
export function frameCount(seconds: number, fps: number): number {
  const length = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  return Math.max(1, Math.ceil(Math.min(length, RENDER_MAX_SECONDS) * fps));
}

/** A rendered composition: its MP4, and what the layout audit found while it was captured. */
export interface Rendered {
  file: string;
  layout: VideoCheckFinding[];
}

/**
 * Renders the composition frame by frame in the test browser and encodes it, measuring its layout
 * at a few of those frames on the way (see layout-audit.ts). The browser is closed, and FFmpeg
 * stopped, whatever happens.
 */
export async function renderComposition(request: RenderRequest): Promise<Rendered> {
  await fs.mkdir(request.dir, { recursive: true });
  const stepMs = request.pageTimeoutMs ?? RENDER_PAGE_TIMEOUT_MS;
  const fps = request.fps ?? RENDER_FPS;
  const deadline = Date.now() + RENDER_MAX_MS;
  const late = () =>
    new RenderError("The recording took longer than it may and was stopped.", "video_timeout");
  const step = <T>(work: Promise<T>, error: () => Error = late) =>
    within(work, Math.min(stepMs, Math.max(0, deadline - Date.now())), error);
  const session = await openPage(
    request.executablePath,
    request.compositionUrl,
    { width: request.width, height: request.height },
    { timeoutMs: stepMs, ...(request.launcher ? { launcher: request.launcher } : {}) },
  );
  let encoder: FfmpegRun | null = null;
  try {
    const { page } = session;
    const reported = Number(
      await step(
        page.evaluate(READY_SCRIPT),
        () => new RenderError("The composition did not become ready to play.", "video_not_ready"),
      ),
    );
    const seconds = Number.isFinite(reported) && reported > 0 ? reported : request.seconds;
    if (!(await step(page.evaluate(PREPARE_SCRIPT))))
      throw new RenderError("The composition has no timeline to play.", "video_no_timeline");
    const file = path.join(request.dir, RENDER_FILE);
    encoder = await (request.encoder ?? ffmpegEncoder)(encodeArgs(fps, file), RENDER_MAX_MS);
    const frames = frameCount(seconds, fps);
    const clip = { x: 0, y: 0, width: request.width, height: request.height };
    const audited = auditFrames(frames);
    const samples: { atMs: number; sample: unknown }[] = [];
    for (let index = 0; index < frames; index += 1) {
      await step(page.evaluate(seekScript(index / fps)));
      // A page that breaks its own measuring is not measured there; the video still renders.
      if (audited.has(index))
        samples.push({
          atMs: Math.round((index / fps) * 1000),
          sample: await step(page.evaluate(AUDIT_SCRIPT)).catch(() => null),
        });
      const shot = await step(page.screenshot({ type: "png", clip, scale: "css" }));
      await step(encoder.write(shot));
    }
    const running = encoder;
    encoder = null;
    await within(running.finish(), Math.max(0, deadline - Date.now()), late);
    return { file, layout: layoutFindings(samples) };
  } catch (error) {
    if (error instanceof FfmpegError)
      throw new RenderError(`Encoding the video failed: ${error.message}`);
    throw error;
  } finally {
    encoder?.kill();
    await session.close();
  }
}

/** Why a file is not a recording Penguin keeps. */
export class VideoFileError extends Error {
  constructor(
    message: string,
    readonly code: "video_invalid" | "video_too_large" = "video_invalid",
  ) {
    super(message);
  }
}

/**
 * Reads an EBML variable-length integer at `offset`: its value and how many bytes it took.
 * `keepMarker` keeps the length marker, as element ids are written.
 */
function vint(bytes: Uint8Array, offset: number, keepMarker: boolean) {
  const first = bytes[offset];
  if (first === undefined || first === 0) return null;
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length += 1;
  if (length > 8 || offset + length > bytes.length) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  for (let index = 1; index < length; index += 1) value = value * 256 + bytes[offset + index]!;
  return { value, length };
}

const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];
const DOC_TYPE_ID = 0x4282;

/**
 * Checks that bytes are a WebM Penguin keeps: an EBML header whose document type is `webm`, at
 * most 100 MB. Answers its digest and size; throws a `VideoFileError` otherwise.
 */
export function inspectWebm(input: Uint8Array): { sha256: string; bytes: number } {
  const bytes = input;
  const invalid = (detail: string) =>
    new VideoFileError(`The recording is not a WebM video: ${detail}`);
  if (bytes.length > VIDEO_MAX_BYTES)
    throw new VideoFileError("The recording is larger than 100 MB.", "video_too_large");
  if (bytes.length < 8 || EBML_MAGIC.some((byte, index) => bytes[index] !== byte))
    throw invalid("it has no EBML header.");
  const size = vint(bytes, 4, false);
  if (!size) throw invalid("its header is cut short.");
  const start = 4 + size.length;
  const end = start + size.value;
  if (end > bytes.length) throw invalid("its header is cut short.");
  let docType: string | null = null;
  for (let offset = start; offset < end;) {
    const id = vint(bytes, offset, true);
    if (!id) throw invalid("its header is malformed.");
    const length = vint(bytes, offset + id.length, false);
    if (!length) throw invalid("its header is malformed.");
    const body = offset + id.length + length.length;
    if (body + length.value > end) throw invalid("its header is malformed.");
    if (id.value === DOC_TYPE_ID)
      docType = Buffer.from(bytes.subarray(body, body + length.value))
        .toString("latin1")
        .replace(/\0+$/, "");
    offset = body + length.value;
  }
  if (docType !== "webm") throw invalid(`its document type is ${docType ?? "missing"}.`);
  return { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
}

/** Checks a recording of either format; see `inspectMp4` and `inspectWebm`. */
export function inspectVideo(bytes: Uint8Array, format: VideoFormat) {
  return format === "mp4" ? inspectMp4(bytes) : inspectWebm(bytes);
}

/** The media type of a recording: MP4 when it opens with an `ftyp` box, WebM otherwise. */
export function videoMimeType(bytes: Uint8Array): "video/mp4" | "video/webm" {
  return isoBox(bytes) === "ftyp" ? "video/mp4" : "video/webm";
}

/** The type of the ISO media box at the start of `bytes`, or null when there is none. */
function isoBox(bytes: Uint8Array): string | null {
  if (bytes.length < 8) return null;
  return Buffer.from(bytes.subarray(4, 8)).toString("latin1");
}

/**
 * Checks that bytes are an MP4 Penguin keeps: an ISO media file that opens with its `ftyp`
 * box, at most 100 MB. Answers its digest and size; throws a `VideoFileError` otherwise.
 */
export function inspectMp4(bytes: Uint8Array): { sha256: string; bytes: number } {
  if (bytes.length > VIDEO_MAX_BYTES)
    throw new VideoFileError("The recording is larger than 100 MB.", "video_too_large");
  const size = bytes.length >= 8 ? Buffer.from(bytes.subarray(0, 4)).readUInt32BE(0) : 0;
  if (isoBox(bytes) !== "ftyp" || size < 8 || size > bytes.length)
    throw new VideoFileError("The recording is not an MP4 video: it has no ftyp box.");
  return { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
}

/** Reads a recording from disk: a regular file, never a link, and at most 100 MB. */
export async function readVideoFile(file: string): Promise<Buffer> {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new VideoFileError("The recording is not a regular file.");
  if (stat.size > VIDEO_MAX_BYTES)
    throw new VideoFileError("The recording is larger than 100 MB.", "video_too_large");
  const bytes = await fs.readFile(file);
  if (bytes.length > VIDEO_MAX_BYTES)
    throw new VideoFileError("The recording is larger than 100 MB.", "video_too_large");
  return bytes;
}
