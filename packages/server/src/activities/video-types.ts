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
  /**
   * Set when the run rendered the asset's timeline (see video-timeline.ts) rather than recorded
   * a composition; `compositionRunId` is then its first cut's.
   */
  fromTimeline?: true;
  /** What the final check found in the video the run made (see video-check.ts). */
  check?: VideoCheck;
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
  /** Set when captions were written beside it, as WebVTT. */
  captions?: true;
}

/** What the final check of a made video can find. */
export type VideoCheckCode =
  /** FFmpeg could not read its length or its picture. */
  | "unreadable"
  /** It plays for noticeably longer or shorter than it should. */
  | "duration_off"
  /** Its picture is not the size it should be. */
  | "size_off"
  /** It should have sound and has none. */
  | "audio_missing"
  /** It has sound, but almost none can be heard. */
  | "silent"
  /** Its loudest moment is at the edge of distorting. */
  | "clipping"
  /** A narration should be speaking, and the sound is silent there. */
  | "narration_silent"
  /** The picture is black for a stretch. */
  | "black"
  /** Two of the composition's main objects cover each other (see the layout audit). */
  | "layout_overlap"
  /** A main object is partly outside the stage. */
  | "off_stage"
  /** Text is smaller than learners can read on a small screen. */
  | "small_text";

export interface VideoCheckFinding {
  code: VideoCheckCode;
  /** An error is something to fix before keeping the video; a warning is worth a look. */
  severity: "error" | "warning";
  /** Where in the video, when it is about a stretch of it. */
  startMs?: number;
  endMs?: number;
  /** The narration it is about. */
  asset?: string;
  /** The composition's elements it is about, by id (or tag when they have none). */
  elements?: string[];
}

/**
 * The final check of a made video, read from FFmpeg's own report of it: what it measured, and
 * what it found against what the video should be. `fail` when it could not be read at all,
 * `revise` when anything is an error, `pass` otherwise.
 */
export interface VideoCheck {
  status: "pass" | "revise" | "fail";
  durationMs: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  hasAudio: boolean;
  /** Mean and peak loudness in dB, when it has sound. */
  meanDb: number | null;
  peakDb: number | null;
  findings: VideoCheckFinding[];
}
