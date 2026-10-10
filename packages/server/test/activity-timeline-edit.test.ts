/**
 * An agent refining a scene video's timeline. What this proves: storyboard frames are placed one
 * after another; the agent is given the scene's narration (with scripts and lengths), music and
 * effects and nothing of other scenes; and what it writes is kept only when it is a well-formed
 * timeline on the same canvas and rate, cutting from the given recordings and naming the scene's
 * own audio.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MediaAsset } from "../src/activities/media.js";
import {
  collectTimelineEdit,
  framesOnTimeline,
  placeFrames,
  TIMELINE_OUTPUT_FILE,
  timelineEditInput,
  timelineEditTarget,
} from "../src/activities/timeline-edit.js";
import type { VideoTimeline } from "../src/activities/video-timeline-types.js";

const source = { runId: `run_${"a".repeat(32)}`, sha256: "b".repeat(64), format: "mp4" as const };
const usage = (sceneId: string) => ({
  sceneId,
  sourceKey: "x",
  occurrence: 1,
  sceneOccurrenceCount: 1,
});

const assets: MediaAsset[] = [
  { key: "video", type: "video", description: "The chest opens", usages: [usage("s2")] },
  {
    key: "line",
    type: "audio",
    description: "Line",
    script: "We are going on a treasure hunt.",
    durationMs: 2064,
    usages: [usage("s2")],
  },
  { key: "tune", type: "audio", description: "Calm", kind: "music", usages: [usage("s2")] },
  { key: "chime", type: "audio", description: "A chime", kind: "sfx", usages: [usage("s2")] },
  { key: "elsewhere", type: "audio", description: "Other", script: "Bye.", usages: [usage("s3")] },
];

const timeline: VideoTimeline = {
  version: 1,
  width: 640,
  height: 480,
  fps: 30,
  cuts: [{ id: "cut-1", source, inMs: 0, outMs: 12000, transition: "cut", transitionMs: 0 }],
  narration: [{ asset: "line", startMs: 500 }],
  music: null,
  effects: [],
  captions: { enabled: true, maxWords: 8, maxChars: 42 },
};

describe("refining a timeline", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
  });

  const frames = placeFrames([
    { id: "frame-1", description: "Closed", seconds: 3 },
    { id: "frame-2", description: "Opens", seconds: 4.5 },
  ]);
  const input = timelineEditInput(assets, "video", "Scene 2", timeline, frames);
  const target = timelineEditTarget("en-US", input);

  it("places the frames and gives the agent only the scene's audio", () => {
    expect(frames).toEqual([
      { id: "frame-1", description: "Closed", startMs: 0, endMs: 3000 },
      { id: "frame-2", description: "Opens", startMs: 3000, endMs: 7500 },
    ]);
    expect(input.narration).toEqual([
      { asset: "line", script: "We are going on a treasure hunt.", lengthMs: 2064 },
    ]);
    expect(input.music).toEqual([{ asset: "tune", description: "Calm" }]);
    expect(input.effects).toEqual([{ asset: "chime", description: "A chime" }]);
    expect(target).toMatchObject({
      assetKey: "video",
      sources: [source],
      narration: ["line"],
      music: ["tune"],
      effects: ["chime"],
    });
  });

  async function written(value: unknown): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-timeline-edit-"));
    dirs.push(dir);
    if (value !== undefined)
      await fs.writeFile(path.join(dir, TIMELINE_OUTPUT_FILE), JSON.stringify(value));
    return dir;
  }

  it("moves the frames to where the timeline shows them, after trims and cuts", () => {
    // The first 1.5 s trimmed off; then the recording again from 6 s, after a 0.5 s fade.
    const edited = {
      cuts: [
        { ...timeline.cuts[0]!, inMs: 1500, outMs: 4000 },
        { ...timeline.cuts[0]!, id: "cut-2", inMs: 6000, outMs: 7500 },
        { ...timeline.cuts[0]!, id: "cut-3", source: { ...source, runId: "run_other" } },
      ].map((cut, index) =>
        index === 1 ? { ...cut, transition: "fade" as const, transitionMs: 500 } : cut,
      ),
    };
    expect(framesOnTimeline(frames, edited, source.runId)).toEqual([
      { id: "frame-1", description: "Closed", startMs: 0, endMs: 1500 },
      { id: "frame-2", description: "Opens", startMs: 1500, endMs: 2500 },
      { id: "frame-2", description: "Opens", startMs: 2000, endMs: 3500 },
    ]);
    // Uncut, the frames stay where they were.
    expect(framesOnTimeline(frames, timeline, source.runId)).toEqual(frames);
  });

  it("keeps a refined timeline that stays within what it was given", async () => {
    const refined: VideoTimeline = {
      ...timeline,
      narration: [{ asset: "line", startMs: 3300 }],
      music: { asset: "tune", volume: 0.3, fadeInMs: 500, fadeOutMs: 500, duck: true },
      effects: [{ asset: "chime", startMs: 3000, volume: 0.8 }],
    };
    expect(await collectTimelineEdit(await written(refined), target)).toEqual(refined);
  });

  it("refuses what is missing, malformed, resized, or reaches outside the scene", async () => {
    const refused = async (value: unknown) =>
      collectTimelineEdit(await written(value), target).then(
        () => null,
        (error: Error) => error.message,
      );
    expect(await refused(undefined)).toContain("without timeline.json");
    expect(await refused({ ...timeline, cuts: [] })).toContain("no cuts");
    expect(await refused({ ...timeline, width: 1280 })).toContain("size or frame rate");
    expect(
      await refused({
        ...timeline,
        cuts: [{ ...timeline.cuts[0]!, source: { ...source, runId: `run_${"c".repeat(32)}` } }],
      }),
    ).toContain("not given");
    expect(
      await refused({ ...timeline, narration: [{ asset: "elsewhere", startMs: 0 }] }),
    ).toContain("does not have: elsewhere");
  });
});
