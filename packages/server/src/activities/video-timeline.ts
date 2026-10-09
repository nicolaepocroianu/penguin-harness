/**
 * A scene video's timeline (experimental, behind `activityVideoExperiment`): how its finished
 * video is put together from recordings, narration, music, effects and captions. The types are
 * in video-timeline-types.ts.
 *
 * A timeline is kept on its video or animation asset in the media plan (`MediaAsset.timeline`),
 * so it is saved, versioned and carried across a re-plan with the rest of the asset, and never
 * reaches the module (see `wafManifest`). Its shape is checked whenever the plan is
 * (`parseTimeline`); what it refers to is only reported (`timelineIssues`), so a re-plan that
 * drops an asset never makes the plan unsaveable.
 *
 * Rendering a timeline is FFmpeg's (see ffmpeg.ts): the cuts are joined, crossfaded where they
 * say so, the audio mixed over them with the music turned down under narration, and the
 * captions written as WebVTT beside the video.
 */
import type { MediaAsset } from "./media.js";
import type {
  TimelineCaptions,
  TimelineCut,
  TimelineIssue,
  TimelineMusic,
  VideoTimeline,
} from "./video-timeline-types.js";
import type { VideoFormat } from "./video-types.js";

/** The longest a timeline plays. */
export const TIMELINE_MAX_MS = 10 * 60_000;
export const TIMELINE_MAX_CUTS = 50;
export const TIMELINE_MAX_NARRATION = 50;
export const TIMELINE_MAX_EFFECTS = 100;
/** The longest fade between two cuts. */
export const TRANSITION_MAX_MS = 5_000;
/** Captions of at most this many words and characters, as OpenMontage's subtitle tool cuts them. */
export const CAPTION_MAX_WORDS = 8;
export const CAPTION_MAX_CHARS = 42;
/** In a default timeline: silence before the first narration, and between narrations. */
export const NARRATION_LEAD_MS = 500;
export const NARRATION_GAP_MS = 400;
/** A narration's length when nothing measured it: this long a word. */
export const ESTIMATED_WORD_MS = 400;
/** Music under narration in a default timeline, when its asset says no volume. */
export const MUSIC_DEFAULT_VOLUME = 0.3;
export const MUSIC_FADE_MS = 1_000;

const RUN_ID = /^run_[a-f0-9]{32}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function object(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Invalid video timeline: ${what} is not an object.`);
  return value as Record<string, unknown>;
}

function only(value: Record<string, unknown>, keys: string[], what: string): void {
  const extra = Object.keys(value).find((key) => !keys.includes(key));
  if (extra !== undefined)
    throw new Error(`Invalid video timeline: ${what} has an unknown field "${extra}".`);
}

function whole(value: unknown, what: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)
    throw new Error(
      `Invalid video timeline: ${what} must be a whole number from ${min} to ${max}.`,
    );
  return value;
}

function share(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)
    throw new Error(`Invalid video timeline: ${what} must be from 0 to 1.`);
  return value;
}

function assetKey(value: unknown, what: string): string {
  if (typeof value !== "string" || !SAFE_ID.test(value))
    throw new Error(`Invalid video timeline: ${what} is not an asset key.`);
  return value;
}

function list(value: unknown, what: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    throw new Error(`Invalid video timeline: ${what} must be a list of at most ${max}.`);
  return value;
}

function parseCut(value: unknown, index: number, before: TimelineCut | undefined): TimelineCut {
  const what = `cut ${index + 1}`;
  const cut = object(value, what);
  only(cut, ["id", "source", "inMs", "outMs", "transition", "transitionMs"], what);
  if (typeof cut.id !== "string" || !SAFE_ID.test(cut.id))
    throw new Error(`Invalid video timeline: ${what} has no usable id.`);
  const source = object(cut.source, `${what}'s source`);
  only(source, ["runId", "sha256", "format"], `${what}'s source`);
  if (
    typeof source.runId !== "string" ||
    !RUN_ID.test(source.runId) ||
    typeof source.sha256 !== "string" ||
    !SHA256.test(source.sha256) ||
    (source.format !== "mp4" && source.format !== "webm")
  )
    throw new Error(`Invalid video timeline: ${what}'s source is not a recording.`);
  const inMs = whole(cut.inMs, `${what}'s start`, 0, TIMELINE_MAX_MS);
  const outMs = whole(cut.outMs, `${what}'s end`, 1, TIMELINE_MAX_MS);
  if (outMs <= inMs) throw new Error(`Invalid video timeline: ${what} must end after it starts.`);
  if (!["cut", "fade", "fadeblack"].includes(cut.transition as string))
    throw new Error(`Invalid video timeline: ${what}'s transition is unknown.`);
  const transition = cut.transition as TimelineCut["transition"];
  const transitionMs = whole(cut.transitionMs, `${what}'s transition length`, 0, TRANSITION_MAX_MS);
  if ((transition === "cut") !== (transitionMs === 0))
    throw new Error(`Invalid video timeline: only a fade into ${what} takes time.`);
  if (!before && transition !== "cut")
    throw new Error("Invalid video timeline: the first cut cannot fade in from another.");
  if (before && transitionMs > Math.min(outMs - inMs, before.outMs - before.inMs))
    throw new Error(`Invalid video timeline: the fade into ${what} is longer than a cut it joins.`);
  return {
    id: cut.id,
    source: { runId: source.runId, sha256: source.sha256, format: source.format as VideoFormat },
    inMs,
    outMs,
    transition,
    transitionMs,
  };
}

function parseMusic(value: unknown): TimelineMusic | null {
  if (value === null) return null;
  const music = object(value, "the music");
  only(music, ["asset", "volume", "fadeInMs", "fadeOutMs", "duck"], "the music");
  if (typeof music.duck !== "boolean")
    throw new Error("Invalid video timeline: the music's ducking must be true or false.");
  return {
    asset: assetKey(music.asset, "the music"),
    volume: share(music.volume, "the music's volume"),
    fadeInMs: whole(music.fadeInMs, "the music's fade in", 0, TIMELINE_MAX_MS),
    fadeOutMs: whole(music.fadeOutMs, "the music's fade out", 0, TIMELINE_MAX_MS),
    duck: music.duck,
  };
}

function parseCaptions(value: unknown): TimelineCaptions {
  const captions = object(value, "the captions");
  only(captions, ["enabled", "maxWords", "maxChars"], "the captions");
  if (typeof captions.enabled !== "boolean")
    throw new Error("Invalid video timeline: captions must be on or off.");
  return {
    enabled: captions.enabled,
    maxWords: whole(captions.maxWords, "the words per caption", 1, 20),
    maxChars: whole(captions.maxChars, "the characters per caption", 10, 120),
  };
}

/**
 * Checks a timeline's shape and answers it, with nothing but its own fields. Throws an Error
 * saying what is wrong otherwise. What it refers to is not checked here (see `timelineIssues`).
 */
export function parseTimeline(value: unknown): VideoTimeline {
  const timeline = object(value, "the timeline");
  only(
    timeline,
    ["version", "width", "height", "fps", "cuts", "narration", "music", "effects", "captions"],
    "the timeline",
  );
  if (timeline.version !== 1)
    throw new Error("Invalid video timeline: its version is not one Penguin reads.");
  const cuts: TimelineCut[] = [];
  const cutList = list(timeline.cuts, "the cuts", TIMELINE_MAX_CUTS);
  if (!cutList.length) throw new Error("Invalid video timeline: it has no cuts.");
  for (const [index, value] of cutList.entries()) cuts.push(parseCut(value, index, cuts.at(-1)));
  if (new Set(cuts.map((cut) => cut.id)).size !== cuts.length)
    throw new Error("Invalid video timeline: two cuts share an id.");
  const parsed: VideoTimeline = {
    version: 1,
    width: whole(timeline.width, "the width", 16, 4096),
    height: whole(timeline.height, "the height", 16, 4096),
    fps: whole(timeline.fps, "the frame rate", 1, 60),
    cuts,
    narration: list(timeline.narration, "the narration", TIMELINE_MAX_NARRATION).map(
      (value, index) => {
        const what = `narration ${index + 1}`;
        const entry = object(value, what);
        only(entry, ["asset", "startMs"], what);
        return {
          asset: assetKey(entry.asset, what),
          startMs: whole(entry.startMs, `${what}'s start`, 0, TIMELINE_MAX_MS),
        };
      },
    ),
    music: parseMusic(timeline.music),
    effects: list(timeline.effects, "the effects", TIMELINE_MAX_EFFECTS).map((value, index) => {
      const what = `effect ${index + 1}`;
      const entry = object(value, what);
      only(entry, ["asset", "startMs", "volume"], what);
      return {
        asset: assetKey(entry.asset, what),
        startMs: whole(entry.startMs, `${what}'s start`, 0, TIMELINE_MAX_MS),
        volume: share(entry.volume, `${what}'s volume`),
      };
    }),
    captions: parseCaptions(timeline.captions),
  };
  if (timelineLengthMs(parsed) > TIMELINE_MAX_MS)
    throw new Error("Invalid video timeline: it plays for longer than ten minutes.");
  return parsed;
}

/**
 * Where each cut starts on the timeline. A fade overlaps the cut it leads into with the end of
 * the one before, so that cut starts its fade's length earlier.
 */
export function cutStarts(timeline: Pick<VideoTimeline, "cuts">): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const cut of timeline.cuts) {
    at -= cut.transitionMs;
    starts.push(at);
    at += cut.outMs - cut.inMs;
  }
  return starts;
}

/** How long the timeline's video plays. */
export function timelineLengthMs(timeline: Pick<VideoTimeline, "cuts">): number {
  const last = timeline.cuts.at(-1);
  if (!last) return 0;
  return cutStarts(timeline).at(-1)! + last.outMs - last.inMs;
}

/** A narration: an audio asset with a script, neither music nor an effect nor a book word. */
export function isNarration(asset: MediaAsset): boolean {
  return asset.type === "audio" && asset.kind === undefined && asset.role === undefined;
}

/** How long a narration's clip plays, when that is known. */
export function narrationLengthMs(asset: MediaAsset): number | null {
  if (asset.durationMs !== undefined) return asset.durationMs;
  const last = asset.wordTimings?.at(-1);
  return last ? last.endMs : null;
}

/**
 * What a saved timeline refers to that the finished video would get wrong, against the audio
 * assets of its language. Empty when nothing is.
 */
export function timelineIssues(timeline: VideoTimeline, assets: MediaAsset[]): TimelineIssue[] {
  const issues: TimelineIssue[] = [];
  const byKey = new Map(assets.map((asset) => [asset.key, asset]));
  const length = timelineLengthMs(timeline);
  /** The asset, when it exists, is audio of the right kind and has a clip; null after an issue. */
  const usable = (key: string, fits: (asset: MediaAsset) => boolean): MediaAsset | null => {
    const asset = byKey.get(key);
    if (!asset) issues.push({ code: "asset_missing", asset: key });
    else if (!fits(asset)) issues.push({ code: "asset_kind", asset: key });
    else if (!asset.path) issues.push({ code: "asset_unbound", asset: key });
    else return asset;
    return null;
  };
  const spoken: { asset: string; startMs: number; endMs: number }[] = [];
  for (const entry of timeline.narration) {
    const asset = usable(entry.asset, isNarration);
    if (!asset) continue;
    const ms = narrationLengthMs(asset);
    if (ms === null) {
      issues.push({ code: "narration_length_unknown", asset: entry.asset });
      continue;
    }
    if (timeline.captions.enabled && !asset.wordTimings?.length)
      issues.push({ code: "captions_untimed", asset: entry.asset });
    if (entry.startMs + ms > length) issues.push({ code: "past_end", asset: entry.asset });
    spoken.push({ asset: entry.asset, startMs: entry.startMs, endMs: entry.startMs + ms });
  }
  spoken.sort((a, b) => a.startMs - b.startMs);
  for (let index = 1; index < spoken.length; index += 1)
    if (spoken[index]!.startMs < spoken[index - 1]!.endMs)
      issues.push({ code: "narration_overlap", asset: spoken[index]!.asset });
  if (timeline.music) usable(timeline.music.asset, (asset) => asset.kind === "music");
  for (const effect of timeline.effects) {
    const asset = usable(effect.asset, (candidate) => candidate.kind === "sfx");
    if (!asset) continue;
    if (effect.startMs >= length) issues.push({ code: "past_end", asset: effect.asset });
  }
  return issues;
}

/** A recording a default timeline starts from. */
export interface TimelineRecording {
  runId: string;
  sha256: string;
  format: VideoFormat;
  /** How long it plays. */
  seconds: number;
  width: number;
  height: number;
  fps: number;
}

/**
 * The timeline a scene video starts with: its recording whole, the scene's narrations one after
 * another from just after the start, the scene's first music under them (turned down while
 * they speak), no effects, and captions on. `assets` are the media of the video's language;
 * the scene is the one the video is used in first.
 */
export function defaultTimeline(
  assets: MediaAsset[],
  videoKey: string,
  recording: TimelineRecording,
): VideoTimeline {
  const scene = assets.find((asset) => asset.key === videoKey)?.usages[0]?.sceneId;
  const inScene = assets.filter(
    (asset) => scene !== undefined && asset.usages.some((usage) => usage.sceneId === scene),
  );
  const narration = [];
  let at = NARRATION_LEAD_MS;
  for (const asset of inScene.filter(isNarration)) {
    narration.push({ asset: asset.key, startMs: at });
    const words = (asset.script ?? "").split(/\s+/).filter(Boolean).length;
    at += (narrationLengthMs(asset) ?? Math.max(1, words) * ESTIMATED_WORD_MS) + NARRATION_GAP_MS;
  }
  const music = inScene.find((asset) => asset.kind === "music");
  return {
    version: 1,
    width: recording.width,
    height: recording.height,
    fps: recording.fps,
    cuts: [
      {
        id: "cut-1",
        source: { runId: recording.runId, sha256: recording.sha256, format: recording.format },
        inMs: 0,
        outMs: Math.max(1, Math.round(recording.seconds * 1000)),
        transition: "cut",
        transitionMs: 0,
      },
    ],
    narration,
    music: music
      ? {
          asset: music.key,
          volume: music.volume ?? MUSIC_DEFAULT_VOLUME,
          fadeInMs: MUSIC_FADE_MS,
          fadeOutMs: MUSIC_FADE_MS,
          duck: true,
        }
      : null,
    effects: [],
    captions: { enabled: true, maxWords: CAPTION_MAX_WORDS, maxChars: CAPTION_MAX_CHARS },
  };
}

/** One caption: its text and when, on the timeline, it shows. */
export interface CaptionCue {
  startMs: number;
  endMs: number;
  text: string;
}

/**
 * The captions of a timeline's narration, from each clip's word timings: words gathered into
 * captions of at most `maxWords` words and `maxChars` characters, a sentence's end closing its
 * caption, each shown from its first word to its last. A narration without word timings, or
 * one naming no narration, gives none (`timelineIssues` says so).
 */
export function captionCues(timeline: VideoTimeline, assets: MediaAsset[]): CaptionCue[] {
  if (!timeline.captions.enabled) return [];
  const { maxWords, maxChars } = timeline.captions;
  const byKey = new Map(assets.map((asset) => [asset.key, asset]));
  const cues: CaptionCue[] = [];
  for (const entry of timeline.narration) {
    const asset = byKey.get(entry.asset);
    if (!asset || !isNarration(asset)) continue;
    let words: { word: string; startMs: number; endMs: number }[] = [];
    const close = () => {
      if (!words.length) return;
      cues.push({
        startMs: entry.startMs + words[0]!.startMs,
        endMs: entry.startMs + words.at(-1)!.endMs,
        text: words.map((word) => word.word).join(" "),
      });
      words = [];
    };
    const written = writtenWords(asset);
    for (const timing of asset.wordTimings ?? []) {
      const word = written(timing.word.trim());
      if (!word) continue;
      const text = [...words.map((taken) => taken.word), word].join(" ");
      if (words.length && (words.length >= maxWords || text.length > maxChars)) close();
      words.push({ word, startMs: timing.startMs, endMs: timing.endMs });
      if (/[.!?…]["'”’)\]]*$/.test(word)) close();
    }
    close();
  }
  return cues.sort((a, b) => a.startMs - b.startMs);
}

/** A word stripped to its letters and digits, lowercased, for comparing. */
function bare(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Gives each timed word back the spelling and punctuation it has in the narration's script.
 * Word timings often come without punctuation ("letter" where the script says "letter."), and
 * a caption reads, and breaks at a sentence's end, by the script's. A timed word that does not
 * match the next written ones keeps its own form.
 */
function writtenWords(asset: MediaAsset): (word: string) => string {
  const script = (asset.script ?? "").split(/\s+/).filter((token) => bare(token));
  let next = 0;
  return (word) => {
    for (let ahead = next; ahead < Math.min(next + 3, script.length); ahead += 1)
      if (bare(script[ahead]!) === bare(word)) {
        next = ahead + 1;
        return script[ahead]!;
      }
    return word;
  };
}

/** A time as WebVTT writes it: `hh:mm:ss.mmm`. */
function vttTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor(total / 60_000) % 60;
  const seconds = Math.floor(total / 1000) % 60;
  const rest = total % 1000;
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(rest, 3)}`;
}

/** Captions as a WebVTT file. Cue text is escaped, so a caption never reads as markup. */
export function webVtt(cues: CaptionCue[]): string {
  const escape = (text: string) =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return (
    "WEBVTT\n\n" +
    cues
      .map((cue) => `${vttTime(cue.startMs)} --> ${vttTime(cue.endMs)}\n${escape(cue.text)}\n`)
      .join("\n")
  );
}

/** Where a video's captions are kept: beside it, as `<name>.vtt`. */
export function captionsPath(videoPath: string): string {
  return videoPath.replace(/\.[^./]+$/, "") + ".vtt";
}
