/**
 * What the App sees of a scene composition (see composition.ts): the run's record, its
 * candidate and the experiment's setup. Type-only, so the web type graph never pulls in the
 * server module.
 */

/** Why a composition was not kept; the App words each one. */
export type CompositionProblemCode =
  /** The page loads, or points at, something on the network. */
  | "composition_network"
  /** The page refers to a file that was not staged for it. */
  | "composition_reference"
  /** No paused GSAP timeline is exposed as `window.__composition.timeline`. */
  | "composition_timeline"
  /** The page dropped the template's content policy or its Penguin bridge script. */
  | "composition_template"
  /** The page uses randomness, so two recordings would differ. */
  | "composition_random"
  /** The page is larger than 512 KB. */
  | "composition_size"
  /** frames.json is missing, not JSON, or does not describe the frames. */
  | "composition_frames";

/** One storyboard frame, as the agent described it in frames.json. */
export interface CompositionFrame {
  id: string;
  description: string;
  seconds: number;
}

/** A scene image staged for the composition, and the hash it was staged with. */
export interface CompositionImage {
  key: string;
  /** Where the page finds it: `images/<file>`. */
  file: string;
  sha256: string;
}

/** A composition run's target, recorded when it started. */
export interface CompositionTarget {
  language: string;
  /** The video or animation asset the composition is for. */
  assetKey: string;
  sceneId: string;
  width: number;
  height: number;
  images: CompositionImage[];
  /** The scene look it was made in (see scene-looks.ts); absent for none. */
  look?: string;
  /** Set when the run failed a check of what the agent wrote. */
  problem?: CompositionProblemCode;
}

/** A kept composition: its frames, its length, and the page's hash and size. */
export interface CompositionCandidate {
  frames: CompositionFrame[];
  seconds: number;
  sha256: string;
  bytes: number;
  /** What a read of the page's source suggests will go wrong (see composition-lint.ts). */
  lint?: CompositionLintFinding[];
}

/** What the static read of a composition can find. */
export type CompositionLintCode =
  /** The page reads randomness or the clock. */
  | "nondeterministic"
  /** The page runs its own timers or animation frames. */
  | "own_timers"
  /** A tween repeats forever. */
  | "endless_repeat"
  /** A tween animates width, height, top or left. */
  | "layout_tween"
  /** The scene uses an emoji, drawn differently on every machine. */
  | "emoji"
  /** Text is in capitals. */
  | "all_caps"
  /** A font size is under 28px. */
  | "small_font"
  /** Lorem ipsum, "placeholder", TODO. */
  | "filler";

export interface CompositionLintFinding {
  code: CompositionLintCode;
  /** The piece of the source it was found in. */
  snippet: string;
}

/** `GET /video-setup`: whether the scene-video experiment is on for this server. */
export interface VideoSetup {
  enabled: boolean;
}

/** What a critique run looked at: the video, and the recording and composition it critiqued. */
export interface SceneCritiqueTarget {
  language: string;
  assetKey: string;
  recordingRunId: string;
  compositionRunId: string;
  /** The critique's score once it is kept, so a run list can compare recordings. */
  score?: number;
}

/** A look a scene can be composed in (`GET .../scene-looks`). */
export interface SceneLookSummary {
  id: string;
  name: string;
  description: string;
}

/** A critique of a recorded scene (see scene-critique.ts): its scores, mean, and fixes. */
export interface SceneCritique {
  recordingRunId: string;
  scores: Record<"story" | "layout" | "readability" | "motion" | "learners", number>;
  /** The mean of the scores, to one decimal. */
  score: number;
  fixes: string[];
}
