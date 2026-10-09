/**
 * Rendering a timeline with FFmpeg. What this proves: the filter graph joins cuts straight on
 * and crossfaded into a video exactly the timeline's length, at its size and frame rate, with
 * narration, looped and ducked music and an effect mixed into one AAC track; a timeline with no
 * audio renders without an audio track. It runs the bundled FFmpeg on clips it makes itself.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runFfmpeg } from "../src/activities/ffmpeg.js";
import type { MediaAsset } from "../src/activities/media.js";
import { timelineRenderArgs } from "../src/activities/timeline-render.js";
import type { VideoTimeline } from "../src/activities/video-timeline-types.js";

const options = { purpose: "for this test", timeoutMs: 60_000 };
const source = { runId: `run_${"a".repeat(32)}`, sha256: "b".repeat(64), format: "mp4" as const };

/** What FFmpeg says of a file's streams and length. */
async function probe(file: string): Promise<string> {
  const error = await runFfmpeg(["-hide_banner", "-i", file], options).catch(
    (failure: { stderr?: string }) => failure.stderr ?? "",
  );
  return String(error);
}

function durationOf(report: string): number {
  const match = /Duration: (\d+):(\d+):([\d.]+)/.exec(report);
  if (!match) throw new Error(`No duration in: ${report}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

describe("timeline rendering", () => {
  let dir = "";
  const file = (name: string) => path.join(dir, name);

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-timeline-"));
    // A 3 s recording at another size and rate, a 1 s line of speech, 1 s of music and a blip.
    await runFfmpeg(
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=320x240:rate=25:duration=3",
        "-pix_fmt",
        "yuv420p",
      ].concat(["-c:v", "libx264", file("recording.mp4")]),
      options,
    );
    for (const [name, source] of [
      ["speech.wav", "sine=frequency=440:duration=1"],
      ["music.wav", "sine=frequency=220:duration=1"],
      ["blip.wav", "sine=frequency=880:duration=0.2"],
    ])
      await runFfmpeg(["-y", "-f", "lavfi", "-i", source!, file(name!)], options);
  }, 60_000);

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const assets: MediaAsset[] = [
    { key: "music", type: "audio", description: "m", kind: "music", loop: true, usages: [] },
  ];

  it("joins and crossfades cuts and mixes narration, ducked looping music and an effect", async () => {
    const timeline: VideoTimeline = {
      version: 1,
      width: 640,
      height: 360,
      fps: 30,
      cuts: [
        { id: "a", source, inMs: 0, outMs: 2000, transition: "cut", transitionMs: 0 },
        { id: "b", source, inMs: 1000, outMs: 3000, transition: "fade", transitionMs: 500 },
        { id: "c", source, inMs: 0, outMs: 1000, transition: "cut", transitionMs: 0 },
      ],
      narration: [{ asset: "line", startMs: 500 }],
      music: { asset: "music", volume: 0.5, fadeInMs: 300, fadeOutMs: 300, duck: true },
      effects: [{ asset: "blip", startMs: 2000, volume: 1 }],
      captions: { enabled: true, maxWords: 8, maxChars: 42 },
    };
    const out = file("finished.mp4");
    const recording = file("recording.mp4");
    await runFfmpeg(
      timelineRenderArgs(
        timeline,
        {
          cuts: [recording, recording, recording],
          audio: new Map([
            ["line", file("speech.wav")],
            ["music", file("music.wav")],
            ["blip", file("blip.wav")],
          ]),
          assets,
        },
        out,
      ),
      options,
    );
    const report = await probe(out);
    // 2 s + 2 s − 0.5 s fade + 1 s.
    expect(durationOf(report)).toBeCloseTo(4.5, 1);
    expect(report).toMatch(/Video: h264.*640x360.*30 fps/);
    expect(report).toMatch(/Audio: aac.*48000 Hz, stereo/);
  }, 60_000);

  it("renders a timeline without audio with no audio track", async () => {
    const out = file("silent.mp4");
    await runFfmpeg(
      timelineRenderArgs(
        {
          version: 1,
          width: 320,
          height: 240,
          fps: 25,
          cuts: [{ id: "a", source, inMs: 500, outMs: 2500, transition: "cut", transitionMs: 0 }],
          narration: [],
          music: null,
          effects: [],
          captions: { enabled: false, maxWords: 8, maxChars: 42 },
        },
        { cuts: [file("recording.mp4")], audio: new Map(), assets: [] },
        out,
      ),
      options,
    );
    const report = await probe(out);
    expect(durationOf(report)).toBeCloseTo(2, 1);
    expect(report).not.toContain("Audio:");
  }, 60_000);
});
