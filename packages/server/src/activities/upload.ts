import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { imageMime } from "./image.js";
import { HttpError } from "../http/errors.js";

/**
 * Media an author supplies by hand, as opposed to media an agent generated. It lives
 * in the activity's own draft workspace under PENGUIN_HOME, never in the shared WAF
 * checkout, which this server only ever reads. A stored file is addressed by the same
 * `media/...` reference a manifest binding uses, so binding an upload is the same act
 * as binding a checkout file.
 */

/** The manifest prefix that means "this file is in the workspace, not the checkout". */
export const UPLOAD_PREFIX = "media/uploads/";

export const UPLOAD_MAX_BYTES = 32 * 1024 * 1024;

export type UploadKind = "image" | "audio" | "video";

export interface UploadedMedia {
  /** The manifest reference, e.g. `media/uploads/cat-1f3a9c2b.png`. */
  path: string;
  name: string;
  kind: UploadKind;
  mimeType: string;
  byteLength: number;
  sha256: string;
  updatedAt: string;
}

interface Format {
  kind: UploadKind;
  mimeType: string;
  extension: string;
}

const AUDIO_VIDEO: {
  mimeType: string;
  extension: string;
  kind: UploadKind;
  match: (b: Buffer) => boolean;
}[] = [
  {
    mimeType: "audio/wav",
    extension: "wav",
    kind: "audio",
    match: (b) =>
      b.length >= 12 &&
      b.toString("ascii", 0, 4) === "RIFF" &&
      b.toString("ascii", 8, 12) === "WAVE",
  },
  {
    mimeType: "audio/mpeg",
    extension: "mp3",
    kind: "audio",
    // An ID3 tag, or a bare MPEG audio frame sync.
    match: (b) =>
      (b.length >= 3 && b.toString("ascii", 0, 3) === "ID3") ||
      (b.length >= 2 && b[0] === 0xff && (b[1]! & 0xe0) === 0xe0),
  },
  {
    mimeType: "audio/ogg",
    extension: "ogg",
    kind: "audio",
    match: (b) => b.length >= 4 && b.toString("ascii", 0, 4) === "OggS",
  },
  {
    mimeType: "video/mp4",
    extension: "mp4",
    kind: "video",
    match: (b) => b.length >= 12 && b.toString("ascii", 4, 8) === "ftyp",
  },
  {
    mimeType: "video/webm",
    extension: "webm",
    kind: "video",
    match: (b) => b.length >= 4 && b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
  },
];

/**
 * The format is read from the bytes, never from the name the browser sent, so a file
 * cannot claim a type it does not have. A WebP is a RIFF container too, so images are
 * tried first.
 */
export function sniffUpload(bytes: Buffer): Format {
  try {
    const mimeType = imageMime(bytes);
    return { kind: "image", mimeType, extension: mimeType.slice("image/".length) };
  } catch {
    // Not an image; fall through to the sound and motion formats.
  }
  for (const format of AUDIO_VIDEO)
    if (format.match(bytes))
      return { kind: format.kind, mimeType: format.mimeType, extension: format.extension };
  throw new HttpError(
    415,
    "media_unsupported",
    "Uploads support PNG, JPEG, GIF and WebP images, WAV, MP3 and Ogg audio, and MP4 and WebM video.",
  );
}

/**
 * A safe stem for the stored name. The author's filename is a hint, not an instruction:
 * everything outside the allowed set collapses to a hyphen, and an empty result is named
 * for its kind rather than rejected.
 */
export function uploadStem(name: string, kind: UploadKind): string {
  const base = name.slice(name.lastIndexOf("/") + 1).replace(/\.[^.]*$/, "");
  const stem = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return stem || kind;
}

/**
 * The stored reference for these bytes. The content hash is part of the name, so the
 * same file uploaded twice lands on one path and a different file never silently
 * replaces one a scene is already bound to.
 */
export function uploadReference(name: string, bytes: Buffer, format: Format): string {
  const digest = createHash("sha256").update(bytes).digest("hex");
  return `${UPLOAD_PREFIX}${uploadStem(name, format.kind)}-${digest.slice(0, 8)}.${format.extension}`;
}

/** Whether a manifest binding points into the workspace rather than the checkout. */
export function isUploadReference(reference: string | undefined): boolean {
  return !!reference && reference.startsWith(UPLOAD_PREFIX);
}

/**
 * Resolve an upload reference to a file inside one workspace. The reference is checked
 * against the same shape a manifest path must satisfy before it is joined, so a stored
 * binding cannot walk out of the uploads directory.
 */
export function uploadFile(workspace: string, reference: string): string {
  const rest = reference.slice(UPLOAD_PREFIX.length);
  if (
    !isUploadReference(reference) ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(rest) ||
    rest.includes("..")
  )
    throw new HttpError(400, "media_path_invalid", "The uploaded media reference is invalid.");
  return path.join(workspace, "media", "uploads", rest);
}

/** Write the bytes into the workspace, or accept that they are already there. */
export async function storeUpload(
  workspace: string,
  name: string,
  bytes: Buffer,
): Promise<UploadedMedia> {
  if (!bytes.byteLength) throw new HttpError(400, "media_empty", "The uploaded file is empty.");
  if (bytes.byteLength > UPLOAD_MAX_BYTES)
    throw new HttpError(413, "media_too_large", "An uploaded file may be at most 32 MiB.");
  const format = sniffUpload(bytes);
  const reference = uploadReference(name, bytes, format);
  const file = uploadFile(workspace, reference);
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.writeFile(file, bytes, { flag: "wx" });
  } catch (error) {
    // The name carries the content hash, so an existing file is these same bytes.
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const stat = await fs.stat(file);
  return {
    path: reference,
    name: path.basename(file),
    kind: format.kind,
    mimeType: format.mimeType,
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    updatedAt: stat.mtime.toISOString(),
  };
}

/** Everything uploaded into one workspace, newest first. */
export async function listUploads(workspace: string): Promise<UploadedMedia[]> {
  const dir = path.join(workspace, "media", "uploads");
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const entries: UploadedMedia[] = [];
  for (const name of names.slice(0, 2000)) {
    const file = path.join(dir, name);
    const stat = await fs.lstat(file).catch(() => null);
    if (!stat || stat.isSymbolicLink() || !stat.isFile()) continue;
    const bytes = await fs.readFile(file).catch(() => null);
    if (!bytes) continue;
    let format: Format;
    try {
      format = sniffUpload(bytes);
    } catch {
      // A file whose bytes no longer name a supported format is not offered for binding.
      continue;
    }
    entries.push({
      path: `${UPLOAD_PREFIX}${name}`,
      name,
      kind: format.kind,
      mimeType: format.mimeType,
      byteLength: stat.size,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      updatedAt: stat.mtime.toISOString(),
    });
  }
  return entries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/** Read one uploaded file back, for a preview or for assembly. */
export async function readUpload(
  workspace: string,
  reference: string,
): Promise<{ bytes: Buffer; mimeType: string }> {
  const file = uploadFile(workspace, reference);
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isFile())
    throw new HttpError(404, "media_missing", "This uploaded file is no longer in the workspace.");
  if (stat.size > UPLOAD_MAX_BYTES)
    throw new HttpError(413, "media_too_large", "The uploaded file exceeds the 32 MiB limit.");
  const bytes = await fs.readFile(file);
  return { bytes, mimeType: sniffUpload(bytes).mimeType };
}
