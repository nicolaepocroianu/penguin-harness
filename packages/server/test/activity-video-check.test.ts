/**
 * The final check of a made video. What this proves: FFmpeg's report is read for the input's
 * own length, size, rate and sound (never the output's), for black and silent stretches, and for
 * loudness; a good video passes; a wrong length, size, missing or silent sound, clipping,
 * narration over silence and black picture are each found with the right weight; an unreadable
 * file fails. The real check runs the bundled FFmpeg on clips it makes itself.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runFfmpeg } from "../src/activities/ffmpeg.js";
import { checkVideo, judge, parseReport, type VideoReport } from "../src/activities/video-check.js";

const options = { purpose: "for this test", timeoutMs: 60_000 };

function report(overrides: Partial<VideoReport> = {}): VideoReport {
  return {
    durationMs: 4000,
    width: 640,
    height: 480,
    fps: 30,
    hasAudio: true,
    black: [],
    silence: [],
    meanDb: -20,
    peakDb: -2,
    luma: [],
    ...overrides,
  };
}

const expected = {
  durationMs: 4000,
  width: 640,
  height: 480,
  audio: true,
  narration: [{ asset: "line", startMs: 500, endMs: 2500 }],
};

describe("video check", () => {
  it("reads the input's streams, black, silence and loudness from FFmpeg's report", () => {
    const text = [
      "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'x.mp4':",
      "  Duration: 00:00:04.50, start: 0.000000, bitrate: 39 kb/s",
      "  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 640x360 [SAR 1:1 DAR 16:9], 30 kb/s, 30 fps, 30 tbr",
      "  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp",
      "Stream mapping:",
      "Output #0, null, to 'pipe:':",
      "  Stream #0:0: Video: wrapped_avframe, yuv420p(progressive), 320x240, 25 fps",
      "[blackdetect @ 0x1] black_start:0 black_end:0.6 black_duration:0.6",
      "[silencedetect @ 0x2] silence_start: 1.2",
      "[silencedetect @ 0x2] silence_end: 2.4 | silence_duration: 1.2",
      "[silencedetect @ 0x2] silence_start: 4",
      "[Parsed_volumedetect_1 @ 0x3] mean_volume: -21.3 dB",
      "[Parsed_volumedetect_1 @ 0x3] max_volume: -inf dB",
      "[Parsed_metadata_2 @ 0x4] frame:0    pts:0       pts_time:0",
      "[Parsed_metadata_2 @ 0x4] lavfi.signalstats.YAVG=16.0",
      "[Parsed_metadata_2 @ 0x4] frame:1    pts:512     pts_time:0.0333333",
      "[Parsed_metadata_2 @ 0x4] lavfi.signalstats.YAVG=235",
    ].join("\n");
    expect(parseReport(text)).toEqual({
      durationMs: 4500,
      width: 640,
      height: 360,
      fps: 30,
      hasAudio: true,
      black: [{ startMs: 0, endMs: 600 }],
      silence: [
        { startMs: 1200, endMs: 2400 },
        { startMs: 4000, endMs: 4500 },
      ],
      meanDb: -21.3,
      peakDb: -Infinity,
      luma: [
        { ms: 0, y: 16 },
        { ms: 33, y: 235 },
      ],
    });
  });

  it("passes a video that is what it should be", () => {
    expect(judge(report(), expected)).toMatchObject({ status: "pass", findings: [] });
    // A little off in length is still right.
    expect(judge(report({ durationMs: 4150 }), expected).findings).toEqual([]);
  });

  it("finds what is wrong, each with its weight", () => {
    const codes = (overrides: Partial<VideoReport>, expectation = expected) =>
      judge(report(overrides), expectation).findings.map((f) => `${f.code}:${f.severity}`);
    expect(codes({ durationMs: 4500 })).toEqual(["duration_off:warning"]);
    expect(codes({ durationMs: 6000 })).toEqual(["duration_off:error"]);
    expect(codes({ width: 320 })).toEqual(["size_off:error"]);
    expect(codes({ hasAudio: false })).toEqual(["audio_missing:error"]);
    expect(codes({ hasAudio: false }, { ...expected, audio: false })).toEqual([]);
    expect(codes({ meanDb: -70 })).toEqual(["silent:error"]);
    expect(codes({ peakDb: -0.1 })).toEqual(["clipping:warning"]);
    expect(codes({ silence: [{ startMs: 400, endMs: 2300 }] })).toEqual([
      "narration_silent:warning",
    ]);
    expect(codes({ black: [{ startMs: 1000, endMs: 1800 }] })).toEqual(["black:warning"]);
    expect(codes({ black: [{ startMs: 0, endMs: 3900 }] })).toEqual(["black:error"]);
    // Light and dark in turn: four flashes in a second is too many, three is not.
    const flicker = (perSecond: number) =>
      Array.from({ length: 60 }, (_, frame) => ({
        ms: Math.round((frame * 1000) / 30),
        y: Math.floor((frame * perSecond * 2) / 30) % 2 ? 235 : 16,
      }));
    expect(codes({ luma: flicker(4) })).toEqual(["flashing:error"]);
    expect(codes({ luma: flicker(3) })).toEqual([]);
    // A slow fade, and a single cut from dark to light, are not flashes.
    expect(
      codes({ luma: Array.from({ length: 60 }, (_, i) => ({ ms: i * 33, y: 16 + i * 3 })) }),
    ).toEqual([]);
    expect(codes({ luma: [0, 33, 66, 99].map((ms, i) => ({ ms, y: i < 2 ? 16 : 235 })) })).toEqual(
      [],
    );
    expect(judge(report({ durationMs: 6000 }), expected).status).toBe("revise");
    expect(judge(report({ durationMs: null }), expected)).toMatchObject({
      status: "fail",
      findings: [{ code: "unreadable", severity: "error" }],
    });
  });

  describe("with FFmpeg", () => {
    let dir = "";
    const file = (name: string) => path.join(dir, name);
    beforeAll(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-check-"));
      const encode = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-shortest"];
      await runFfmpeg(
        ["-y", "-f", "lavfi", "-i", "testsrc=size=640x480:rate=30:duration=4"]
          .concat(["-f", "lavfi", "-i", "sine=frequency=440:duration=4"])
          .concat(encode, ["-c:a", "aac", file("good.mp4")]),
        options,
      );
      await runFfmpeg(
        ["-y", "-f", "lavfi", "-i", "color=black:size=320x240:rate=25:duration=2"].concat([
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          file("black.mp4"),
        ]),
        options,
      );
      await runFfmpeg(
        [
          "-y",
          "-f",
          "lavfi",
          "-i",
          "color=black:size=160x120:rate=24:duration=2,format=gray,geq=lum='if(mod(floor(N/3),2),235,16)'",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          file("flashing.mp4"),
        ],
        options,
      );
      await fs.writeFile(file("broken.mp4"), "not a video");
    }, 60_000);
    afterAll(async () => {
      await fs.rm(dir, { recursive: true, force: true });
    });

    it("passes a good video", async () => {
      const check = await checkVideo(file("good.mp4"), expected);
      expect(check).toMatchObject({
        status: "pass",
        durationMs: 4000,
        width: 640,
        height: 480,
        fps: 30,
        hasAudio: true,
        findings: [],
      });
    }, 60_000);

    it("finds a short, small, silent, black video, and fails a broken one", async () => {
      const check = await checkVideo(file("black.mp4"), expected);
      expect(check.status).toBe("revise");
      expect(check.findings.map((finding) => finding.code)).toEqual([
        "duration_off",
        "size_off",
        "audio_missing",
        "black",
      ]);
      await expect(checkVideo(file("broken.mp4"), expected)).rejects.toThrow();
    }, 60_000);

    it("finds a video that flashes", async () => {
      const check = await checkVideo(file("flashing.mp4"), {
        ...expected,
        durationMs: 2000,
        width: 160,
        height: 120,
        audio: false,
        narration: [],
      });
      expect(check.findings.map((finding) => finding.code)).toEqual(["flashing"]);
    }, 60_000);
  });
});
