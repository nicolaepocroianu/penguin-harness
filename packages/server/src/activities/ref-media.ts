/**
 * An activity ref's media in the WAF media repository, in Loom's layout:
 *
 *     <wafRoot>/media/loom/<pc>/<pc>-<ref>/
 *       images/<language>/<key>.png          accepted media, bound by the manifest as
 *       audios/<language>/<key>.mp3           media/loom/<pc>/<pc>-<ref>/<folder>/<language>/<key>.<ext>
 *       videos/<language>/<key>.webm          (see mediaTargetPath), each beside a Loom sidecar
 *       animations/<language>/<key>.webm      <key>.json saying what made it
 *       uploads/<name>-<digest>.<ext>         files an author uploaded, bound by their own path
 *       candidates/<runId>.<ext>              takes not accepted yet; never published
 *
 * A generation writes its take straight into the media repository as a candidate. Accepting
 * it copies the take to the asset's own path, replacing what was there, and writes the
 * sidecar. A deploy publishes only the files the activity's data names, so candidates stay
 * out of the repository's history.
 *
 * Audio is kept as MP3, as Loom kept it: a WAV take (Gemini speech) is converted with ffmpeg.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Component, Interface } from "@prismshadow/penguin-core/kernel";
import { HttpError } from "../http/errors.js";
import { FfmpegError, runFfmpeg } from "./ffmpeg.js";
import { withinRoot } from "./sandbox-paths.js";

const RUN_ID = /^run_[a-f0-9]{32}$/;

/** `media/loom/<pc>/<pc>-<ref>`: the ref's media folder, as a manifest names it. */
export function refMediaFolder(productCode: string, refNum: number): string {
  return `media/loom/${productCode}/${productCode}-${refNum}`;
}

/** A manifest's `media/...` path as a file under the WAF root, or null when it would leave it. */
export function mediaFile(wafRoot: string, reference: string): string | null {
  if (!reference.startsWith("media/")) return null;
  return withinRoot(wafRoot, reference);
}

/** `media/loom/<pc>/<pc>-<ref>/candidates/<runId>.<ext>`: a take not accepted yet. */
export function candidateReference(
  productCode: string,
  refNum: number,
  runId: string,
  extension: string,
): string {
  if (!RUN_ID.test(runId)) throw new HttpError(404, "run_not_found", "Candidate not found.");
  return `${refMediaFolder(productCode, refNum)}/candidates/${runId}.${extension}`;
}

/** Where a ref's uploads are, as a folder on disk and as the prefix a manifest binds. */
export interface UploadHome {
  dir: string;
  prefix: string;
}

export function uploadHome(wafRoot: string, productCode: string, refNum: number): UploadHome {
  const prefix = `${refMediaFolder(productCode, refNum)}/uploads/`;
  return { dir: path.join(wafRoot, ...prefix.split("/").filter(Boolean)), prefix };
}

/** What made an accepted file, as Loom's sidecar `<key>.json` records it. */
export interface MediaSidecar {
  /** The script for audio, the description for an image. */
  text: string;
  model: string;
  voice?: string;
  wordTimings?: unknown;
  durationMs?: number;
}

/** Where the sidecar of an accepted `<key>.<ext>` is: `<key>.json` beside it. */
export function sidecarPath(file: string): string {
  return file.replace(/\.[^./\\]+$/, ".json");
}

/** Writes `<key>.json` beside the accepted `<key>.<ext>`, in Loom's shape. */
export async function writeSidecar(file: string, sidecar: MediaSidecar): Promise<void> {
  const target = sidecarPath(file);
  const body = {
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    fileName: path.basename(file),
    text: sidecar.text,
    model: sidecar.model,
    ...(sidecar.wordTimings !== undefined ? { wordTimings: sidecar.wordTimings } : {}),
    ...(sidecar.durationMs !== undefined ? { durationMs: sidecar.durationMs } : {}),
    ...(sidecar.voice && sidecar.voice !== "default" ? { voice: sidecar.voice } : {}),
  };
  await fs.writeFile(target, `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

/** How long one conversion may take. */
export const MP3_TIMEOUT_MS = 60_000;

/**
 * A WAV clip as MP3, through FFmpeg (see ffmpeg.ts). Refused with 503 `ffmpeg_missing` when
 * there is no FFmpeg, since the media repository keeps audio as MP3.
 */
export async function wavToMp3(wav: Uint8Array): Promise<Buffer> {
  const failed = (cause: string) =>
    new HttpError(502, "audio_convert_failed", `Converting the speech to MP3 failed: ${cause}`);
  let mp3: Buffer;
  try {
    mp3 = await runFfmpeg(
      ["-hide_banner", "-loglevel", "error", "-f", "wav", "-i", "pipe:0"].concat([
        "-codec:a",
        "libmp3lame",
        "-q:a",
        "2",
        "-f",
        "mp3",
        "pipe:1",
      ]),
      {
        purpose: "to keep speech as MP3 in the media repository",
        timeoutMs: MP3_TIMEOUT_MS,
        input: wav,
      },
    );
  } catch (error) {
    if (error instanceof FfmpegError) throw failed(error.message);
    throw error;
  }
  if (!mp3.length) throw failed("ffmpeg wrote no MP3.");
  return mp3;
}

/**
 * Re-addresses every binding in one ref's media folder to another's (`from` and `to` are
 * `refMediaFolder`s), in place: what a renumber, a ref made from a template and a restore
 * across a renumber do to the manifest when they move or copy the folder itself.
 */
export function readdressMedia(
  assets: Record<string, { path?: string }[]>,
  from: string,
  to: string,
): void {
  if (from === to) return;
  for (const asset of Object.values(assets).flat())
    if (asset.path?.startsWith(`${from}/`)) asset.path = `${to}${asset.path.slice(from.length)}`;
}

/**
 * Copies one ref's media folder to another's, never following a link and never over an
 * existing file; candidates stay behind, since they were never the template's media.
 */
export async function copyRefMedia(wafRoot: string, from: string, to: string): Promise<void> {
  const source = mediaFile(wafRoot, from);
  const target = mediaFile(wafRoot, to);
  if (!source || !target) return;
  const stat = await fs.lstat(source).catch(() => null);
  if (!stat || !stat.isDirectory()) return;
  await fs.cp(source, target, {
    recursive: true,
    errorOnExist: true,
    force: false,
    filter: async (entry) =>
      path.basename(entry) !== "candidates" && !(await fs.lstat(entry)).isSymbolicLink(),
  });
}

/** Converting audio for the media repository; a test replaces it so nothing runs ffmpeg. */
export abstract class AudioEncodePorts extends Interface<{
  wavToMp3?: (wav: Uint8Array) => Promise<Buffer>;
}>() {}

@Component()
export class DefaultAudioEncodePorts implements AudioEncodePorts {}
