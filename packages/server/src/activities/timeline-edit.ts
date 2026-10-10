/**
 * An agent refining a scene video's timeline (experimental, behind `activityVideoExperiment`): a
 * `timeline` run. The agent reads the timeline the video has (saved, or started from its newest
 * recording; see video-timeline.ts), the storyboard frames the recording shows and when, and the
 * scene's narration, music and effects, and writes the timeline again so the sound follows the
 * picture: each narration over the frame it talks about, effects where the frames show them
 * happening, music under it all.
 *
 * What it writes is checked before it is kept (`collectTimelineEdit`): the timeline's own shape
 * (see `parseTimeline`), the same canvas and frame rate, cuts only from the recordings it was
 * given, and audio only from the scene's. Nothing is saved on the video: the author loads the
 * agent's timeline into the studio's editor, looks it over, and saves it there.
 *
 * The idea is OpenMontage's edit stage, where an "edit director" turns the scene plan and the
 * assets into edit decisions (github.com/calesthio/OpenMontage, skills/pipelines/explainer/), as
 * an idea only; the prompt and the checks are Penguin's own.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { MediaAsset } from "./media.js";
import { isNarration, narrationLengthMs, parseTimeline } from "./video-timeline.js";
import type { TimelineEditTarget, VideoTimeline } from "./video-timeline-types.js";

export const TIMELINE_INPUT_FILE = "timeline-input.json";
export const TIMELINE_OUTPUT_FILE = "timeline.json";
/** The largest timeline.json kept. */
const TIMELINE_MAX_BYTES = 256 * 1024;

/** What a timeline run stages, read before the run is recorded. */
export interface TimelineEditStage {
  target: TimelineEditTarget;
  input: TimelineEditInput;
}

/** The input file the agent reads. */
export interface TimelineEditInput {
  scene: { id: string; description: string };
  video: { assetKey: string; description: string };
  timeline: VideoTimeline;
  /** The storyboard frames of the recording the timeline starts with, placed in time. */
  frames: { id: string; description: string; startMs: number; endMs: number }[];
  narration: { asset: string; script: string; lengthMs: number | null }[];
  music: { asset: string; description: string }[];
  effects: { asset: string; description: string }[];
}

/**
 * The input for refining `timeline`: the scene of the video `videoKey`, its frames (already
 * placed in time by the caller) and the audio of its language that the scene uses.
 */
export function timelineEditInput(
  assets: MediaAsset[],
  videoKey: string,
  sceneDescription: string,
  timeline: VideoTimeline,
  frames: TimelineEditInput["frames"],
): TimelineEditInput {
  const video = assets.find((asset) => asset.key === videoKey);
  const sceneId = video?.usages[0]?.sceneId ?? "";
  const inScene = assets.filter((asset) => asset.usages.some((usage) => usage.sceneId === sceneId));
  return {
    scene: { id: sceneId, description: sceneDescription },
    video: { assetKey: videoKey, description: video?.description ?? "" },
    timeline,
    frames,
    narration: inScene.filter(isNarration).map((asset) => ({
      asset: asset.key,
      script: asset.script ?? "",
      lengthMs: narrationLengthMs(asset),
    })),
    music: inScene
      .filter((asset) => asset.kind === "music")
      .map((asset) => ({ asset: asset.key, description: asset.description })),
    effects: inScene
      .filter((asset) => asset.kind === "sfx")
      .map((asset) => ({ asset: asset.key, description: asset.description })),
  };
}

/** Places storyboard frames, each `seconds` long, one after another from the start. */
export function placeFrames(
  frames: { id: string; description: string; seconds: number }[],
): TimelineEditInput["frames"] {
  let at = 0;
  return frames.map((frame) => {
    const placed = {
      id: frame.id,
      description: frame.description,
      startMs: at,
      endMs: at + Math.round(frame.seconds * 1000),
    };
    at = placed.endMs;
    return placed;
  });
}

/** Stages a timeline run's input into its workspace. */
export async function stageTimelineEdit(
  workspace: string,
  stage: TimelineEditStage,
): Promise<void> {
  await fs.writeFile(
    path.join(workspace, TIMELINE_INPUT_FILE),
    `${JSON.stringify(stage.input, null, 2)}\n`,
    "utf8",
  );
}

export const timelineEditPrompt = `Refine the timeline of a scene video so its sound follows its picture. Work in this workspace.
Read ${TIMELINE_INPUT_FILE}: the scene, the video, its current timeline (every time in whole milliseconds), the storyboard frames the video shows and when each starts and ends, and the narration, music and sound effects the scene has, with each narration's script and length.
Write ${TIMELINE_OUTPUT_FILE}: the whole timeline again, in exactly the same shape as the current one.
- Keep version, width, height and fps as they are, and cut only from the recordings the current cuts use (the same source objects). You may change where cuts start and end and how each begins ("cut", "fade" or "fadeblack" with transitionMs; the first cut is always "cut" with 0).
- Start each narration over the frame it talks about, a moment after that frame begins. Never let two narrations overlap: one ends (its startMs plus its length) before the next starts, with a short gap. Every narration ends before the video does. Leave out a narration only when it plainly belongs to another part of the scene.
- Place a sound effect where a frame shows it happening, at volume 0 to 1.
- Use music only from the scene's list, at volume 0.2 to 0.4, with "duck": true so it lowers under narration, or "music": null when the scene has none.
- Keep captions on unless there is no narration.
Use only the asset keys listed in ${TIMELINE_INPUT_FILE}. Do not edit ${TIMELINE_INPUT_FILE}. Do not delegate this task.
Use Harness's normal approval flow for tool actions. Finish only after writing ${TIMELINE_OUTPUT_FILE}.`;

/** Why what the agent wrote is not a timeline Penguin keeps. */
export class TimelineEditProblem extends Error {}

/** What the agent's timeline must keep to, from what it was given. */
export function timelineEditTarget(language: string, input: TimelineEditInput): TimelineEditTarget {
  const { timeline } = input;
  return {
    language,
    assetKey: input.video.assetKey,
    width: timeline.width,
    height: timeline.height,
    fps: timeline.fps,
    sources: timeline.cuts.map((cut) => cut.source),
    narration: input.narration.map((entry) => entry.asset),
    music: input.music.map((entry) => entry.asset),
    effects: input.effects.map((entry) => entry.asset),
  };
}

/**
 * What a timeline run wrote, checked against what it was given: a well-formed timeline, on the
 * same canvas and at the same rate, cutting only from the given recordings, naming only the
 * scene's audio. Answers it; throws a `TimelineEditProblem` saying what is wrong otherwise.
 */
export async function collectTimelineEdit(
  workspace: string,
  target: TimelineEditTarget,
): Promise<VideoTimeline> {
  const file = path.join(workspace, TIMELINE_OUTPUT_FILE);
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat || !stat.isFile())
    throw new TimelineEditProblem(`The session ended without ${TIMELINE_OUTPUT_FILE}.`);
  if (stat.size > TIMELINE_MAX_BYTES)
    throw new TimelineEditProblem(`${TIMELINE_OUTPUT_FILE} is larger than 256 KB.`);
  let timeline: VideoTimeline;
  try {
    timeline = parseTimeline(JSON.parse(await fs.readFile(file, "utf8")));
  } catch (error) {
    throw new TimelineEditProblem((error as Error).message);
  }
  if (
    timeline.width !== target.width ||
    timeline.height !== target.height ||
    timeline.fps !== target.fps
  )
    throw new TimelineEditProblem("The timeline changed the video's size or frame rate.");
  const sources = new Set(target.sources.map((source) => JSON.stringify(source)));
  if (timeline.cuts.some((cut) => !sources.has(JSON.stringify(cut.source))))
    throw new TimelineEditProblem("The timeline cuts from a recording it was not given.");
  const narration = new Set(target.narration);
  const music = new Set(target.music);
  const effects = new Set(target.effects);
  const stray = [
    ...timeline.narration.filter((entry) => !narration.has(entry.asset)),
    ...(timeline.music && !music.has(timeline.music.asset) ? [timeline.music] : []),
    ...timeline.effects.filter((entry) => !effects.has(entry.asset)),
  ];
  if (stray.length)
    throw new TimelineEditProblem(
      `The timeline names audio the scene does not have: ${stray.map((entry) => entry.asset).join(", ")}.`,
    );
  return timeline;
}
