/** What the audio trim routes take and answer; the web app imports these. */

/**
 * The stretch a trim removes, in seconds from the start of the clip, as Loom's trim takes
 * it: everything outside it is kept.
 */
export interface TrimRange {
  startSeconds: number;
  endSeconds: number;
}

/** The audio asset in one language a trim is for: the card it is made on. */
export interface TrimTarget {
  language: string;
  assetKey: string;
}

/**
 * The clip a trim preview cuts: the target's bound audio, a generated take, an upload, or an
 * earlier preview (a second cut of the same candidate).
 */
export type TrimSource =
  | { kind: "bound" }
  | { kind: "run"; runId: string }
  | { kind: "upload"; path: string }
  | { kind: "preview"; token: string };

/**
 * A trim preview: the trimmed clip, kept outside the media repository until it is saved, and
 * how long it now plays. `savesInPlace` says it was cut from the target's bound audio, so
 * saving it replaces that clip; any other preview is saved by attaching it as an upload.
 */
export interface TrimmedAudio {
  token: string;
  durationMs: number;
  savesInPlace: boolean;
}

/** How a saved trim is given: the preview the author heard, or a range to cut again. */
export type TrimCut = { previewToken: string } | { range: TrimRange };
