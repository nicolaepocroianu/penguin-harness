/** What the audio trim routes take and answer; the web app imports these. */
import type { UploadedMedia } from "./upload.js";

/**
 * The stretch a trim removes, in seconds from the start of the clip, as Loom's trim takes
 * it: everything outside it is kept.
 */
export interface TrimRange {
  startSeconds: number;
  endSeconds: number;
}

/** The clip a trim preview cuts: the bound audio, a generated take, or an upload. */
export type TrimSource =
  | { kind: "bound"; language: string; assetKey: string }
  | { kind: "run"; runId: string }
  | { kind: "upload"; path: string };

/** A trim preview: the trimmed clip, stored as an MP3 upload, and how long it now is. */
export interface TrimmedAudio {
  media: UploadedMedia;
  durationMs: number;
}
