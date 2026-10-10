/**
 * What the App sees of a scene video's timeline (see video-timeline.ts). Type-only, so the web
 * type graph never pulls in the server module.
 *
 * A timeline says how a scene's finished video is put together: which recordings play and
 * where they are cut, which narration, music and effects play over them and when, and whether
 * captions are written. Its shape follows the edit decisions of OpenMontage
 * (github.com/calesthio/OpenMontage, `schemas/artifacts/edit_decisions.schema.json`), as an idea
 * only: one primary track of cuts, audio layered over it, captions from word timings. Every
 * time is in whole milliseconds, as word timings are.
 */
import type { VideoFormat } from "./video-types.js";

/** How a cut begins: straight on, crossfaded from the cut before, or through black. */
export type TimelineTransition = "cut" | "fade" | "fadeblack";

/** One stretch of a recording on the timeline. Cuts play one after another, in order. */
export interface TimelineCut {
  /** Unique within the timeline. */
  id: string;
  /** The recording it takes from: a video run's kept MP4 or WebM, by its digest. */
  source: { runId: string; sha256: string; format: VideoFormat };
  /** Where in the recording the cut starts and ends. */
  inMs: number;
  outMs: number;
  /** How it begins. The first cut always begins with a plain cut. */
  transition: TimelineTransition;
  /** How long a fade takes; 0 for a plain cut. Never longer than this cut or the one before. */
  transitionMs: number;
}

/** A narration clip, by its audio asset's key, starting at a moment of the timeline. */
export interface TimelineNarration {
  asset: string;
  startMs: number;
}

/** Background music under the whole timeline. */
export interface TimelineMusic {
  asset: string;
  /** 0 to 1. */
  volume: number;
  fadeInMs: number;
  fadeOutMs: number;
  /** Turned down while narration speaks. */
  duck: boolean;
}

/** A sound effect, by its audio asset's key. */
export interface TimelineEffect {
  asset: string;
  startMs: number;
  /** 0 to 1. */
  volume: number;
}

/** Captions written beside the video, from the narration's word timings. */
export interface TimelineCaptions {
  enabled: boolean;
  /** The most words one caption shows. */
  maxWords: number;
  /** The most characters one caption shows. */
  maxChars: number;
}

export interface VideoTimeline {
  version: 1;
  width: number;
  height: number;
  fps: number;
  cuts: TimelineCut[];
  narration: TimelineNarration[];
  music: TimelineMusic | null;
  effects: TimelineEffect[];
  captions: TimelineCaptions;
}

/**
 * A timeline run's target (see timeline-edit.ts), recorded when it started: the video, and what
 * the agent's timeline must keep to.
 */
export interface TimelineEditTarget {
  language: string;
  assetKey: string;
  width: number;
  height: number;
  fps: number;
  /** The recordings it may cut from. */
  sources: TimelineCut["source"][];
  /** The scene's audio it may name. */
  narration: string[];
  music: string[];
  effects: string[];
}

/** A video's timeline as the studio reads it (`GET .../video-timeline`). */
export interface VideoTimelineView {
  timeline: VideoTimeline;
  /** False for a timeline started from the newest recording and not saved yet. */
  saved: boolean;
  issues: TimelineIssue[];
}

/**
 * Something about a saved timeline that the finished video would get wrong. None of these stops
 * a timeline being saved: a re-plan may drop an asset a timeline names, and the author decides
 * what to do about it.
 */
export type TimelineIssue =
  /** A narration, music or effect names no audio asset of this language. */
  | { code: "asset_missing"; asset: string }
  /** It names an audio asset of the wrong kind (music as narration, say). */
  | { code: "asset_kind"; asset: string }
  /** The audio asset has no clip bound yet. */
  | { code: "asset_unbound"; asset: string }
  /** The narration's length is not known, so where it ends is not either. */
  | { code: "narration_length_unknown"; asset: string }
  /** Two narrations speak at once. */
  | { code: "narration_overlap"; asset: string }
  /** Narration or an effect runs past the end of the video. */
  | { code: "past_end"; asset: string }
  /** Captions are on, but a narration has no word timings to caption it by. */
  | { code: "captions_untimed"; asset: string };
