/**
 * A critique of a recorded scene video. What this proves: stills are taken at the first moment,
 * the middle of each storyboard frame and the last; a critique is kept only with a whole score
 * from 1 to 5 for each of the rubric and a short list of fixes (and some fix when it scores low);
 * an agent that could not see the stills says so and the run says why; the score is the mean;
 * and the fixes are worded for the agent composing again. Stills are taken with the bundled FFmpeg
 * from a clip it makes itself.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runFfmpeg } from "../src/activities/ffmpeg.js";
import {
  collectCritique,
  CRITIQUE_INPUT_FILE,
  CRITIQUE_OUTPUT_FILE,
  critiqueForAgent,
  critiqueScore,
  stageCritique,
  stillMoments,
} from "../src/activities/scene-critique.js";

const target = {
  language: "en-US",
  assetKey: "video",
  recordingRunId: `run_${"a".repeat(32)}`,
  compositionRunId: `run_${"b".repeat(32)}`,
};
const scores = { story: 4, layout: 3, readability: 5, motion: 4, learners: 5 };

describe("scene critique", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
  });
  async function workspace(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-critique-"));
    dirs.push(dir);
    return dir;
  }

  it("takes stills at the start, each frame's middle, and the end", () => {
    expect(
      stillMoments(
        [
          { id: "frame-1", seconds: 3 },
          { id: "frame-2", seconds: 4 },
        ],
        7000,
      ),
    ).toEqual([
      { atMs: 0 },
      { atMs: 1500, frame: "frame-1" },
      { atMs: 5000, frame: "frame-2" },
      { atMs: 6750 },
    ]);
  });

  it("stages the stills from the recording, and not the recording itself", async () => {
    const dir = await workspace();
    const clip = path.join(dir, "clip.mp4");
    await runFfmpeg(
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=320x240:rate=10:duration=2",
        "-pix_fmt",
        "yuv420p",
      ].concat(["-c:v", "libx264", clip]),
      { purpose: "for this test", timeoutMs: 60_000 },
    );
    const bytes = await fs.readFile(clip);
    await fs.rm(clip);
    await stageCritique(dir, {
      target,
      recording: { bytes, format: "mp4" },
      moments: stillMoments([{ id: "frame-1", seconds: 2 }], 2000),
      input: {
        scene: "Scene",
        video: "Video",
        frames: [{ id: "frame-1", description: "A", seconds: 2 }],
      },
    });
    const input = JSON.parse(await fs.readFile(path.join(dir, CRITIQUE_INPUT_FILE), "utf8"));
    expect(input.stills.map((still: { file: string }) => still.file)).toEqual([
      "stills/still-1.png",
      "stills/still-2.png",
      "stills/still-3.png",
    ]);
    for (const still of input.stills as { file: string }[])
      expect((await fs.readFile(path.join(dir, still.file))).subarray(1, 4).toString()).toBe("PNG");
    expect((await fs.readdir(dir)).filter((name) => name.includes("recording"))).toEqual([]);
  }, 60_000);

  it("keeps a well-formed critique, with its mean", async () => {
    const dir = await workspace();
    await fs.writeFile(
      path.join(dir, CRITIQUE_OUTPUT_FILE),
      JSON.stringify({ scores, fixes: ["Move the map onto the sand."] }),
    );
    expect(await collectCritique(dir, target)).toEqual({
      recordingRunId: target.recordingRunId,
      scores,
      score: 4.2,
      fixes: ["Move the map onto the sand."],
    });
    expect(critiqueScore({ story: 1, layout: 2, readability: 2, motion: 2, learners: 2 })).toBe(
      1.8,
    );
  });

  it("refuses a malformed critique, and says when the agent could not see", async () => {
    const refused = async (value: unknown) => {
      const dir = await workspace();
      if (value !== undefined)
        await fs.writeFile(path.join(dir, CRITIQUE_OUTPUT_FILE), JSON.stringify(value));
      return collectCritique(dir, target).then(
        () => null,
        (error: Error) => error.message,
      );
    };
    expect(await refused(undefined)).toContain("without critique.json");
    expect(await refused({ unseen: true })).toContain("could not see the stills");
    expect(await refused({ scores: { ...scores, motion: 6 }, fixes: [] })).toContain("motion");
    expect(await refused({ scores, fixes: Array(9).fill("Fix it.") })).toContain("at most 8");
    expect(
      await refused({
        scores: { story: 2, layout: 2, readability: 3, motion: 2, learners: 3 },
        fixes: [],
      }),
    ).toContain("listed nothing to fix");
  });

  it("words the fixes for the agent composing again", () => {
    expect(
      critiqueForAgent({
        recordingRunId: target.recordingRunId,
        scores,
        score: 4.2,
        fixes: ["Move the map onto the sand."],
      }),
    ).toEqual([
      "A reviewer of the last recording (score 4.2 of 5) asked: Move the map onto the sand.",
    ]);
  });
});
