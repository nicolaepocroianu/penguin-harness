/**
 * What the App sees of a scene video recording (see video-render.ts): the run's target and the
 * recording it kept. Type-only, so the web type graph never pulls in the server module.
 */

/** Why a recording did not come out, for the causes Penguin knows; the App words each one. */
export type VideoProblemCode =
  /** The composition did not say it was ready within the page timeout. */
  | "video_not_ready"
  /** The page exposes no timeline to play. */
  | "video_no_timeline"
  /** Playing or finishing the recording took longer than the recording's bound. */
  | "video_timeout"
  /** What the browser wrote is not a WebM. */
  | "video_invalid"
  /** What the browser wrote is larger than 100 MB. */
  | "video_too_large"
  /** The server stopped before the recording finished. */
  | "video_stopped";

/** A video run's target, recorded when it started. */
export interface VideoTarget {
  language: string;
  /** The video or animation asset the recording is for. */
  assetKey: string;
  /** The composition run whose page was recorded. */
  compositionRunId: string;
  width: number;
  height: number;
  /** How long the composition says it plays, in seconds. */
  seconds: number;
  /** Set when the run failed for a cause Penguin knows. */
  problem?: VideoProblemCode;
}

/**
 * A recording's file format: an H.264 MP4 from the frame renderer, or a WebM from the page
 * recorder that came before it.
 */
export type VideoFormat = "mp4" | "webm";

/** A kept recording: the run's candidate in the ref's media folder. */
export interface VideoResult {
  runId: string;
  sha256: string;
  bytes: number;
  /** Absent on recordings from before the frame renderer, which are WebM. */
  format?: VideoFormat;
}
