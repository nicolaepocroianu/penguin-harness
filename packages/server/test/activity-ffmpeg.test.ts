/**
 * Which FFmpeg the server runs, and running it. What this proves: an admin's
 * `PENGUIN_FFMPEG_PATH` wins, then the bundled `ffmpeg-static` binary; an FFmpeg that cannot be
 * started is 503 `ffmpeg_missing`, and one that fails says why; and the bundled binary really
 * converts a WAV clip to MP3 and encodes PNG frames to an H.264 MP4.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HttpError } from "../src/http/errors.js";
import { FfmpegError, ffmpegPath, runFfmpeg, startFfmpeg } from "../src/activities/ffmpeg.js";
import { wavToMp3 } from "../src/activities/ref-media.js";
import { encodeArgs, inspectMp4 } from "../src/activities/video-render.js";
import { imagePng } from "./image-fixtures.js";

/** A short silent WAV: 16-bit mono at 8 kHz. */
function silentWav(samples = 800): Buffer {
  const data = samples * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(36 + data, 4);
  header.write("WAVEfmt ", 8, "latin1");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "latin1");
  header.writeUInt32LE(data, 40);
  return Buffer.concat([header, Buffer.alloc(data)]);
}

describe("ffmpeg", () => {
  it("runs the admin's FFmpeg first, then the bundled one", () => {
    expect(ffmpegPath({ PENGUIN_FFMPEG_PATH: " /opt/ffmpeg/bin/ffmpeg " })).toBe(
      "/opt/ffmpeg/bin/ffmpeg",
    );
    const bundled = ffmpegPath({});
    expect(path.basename(bundled)).toMatch(/^ffmpeg(\.exe)?$/);
    expect(path.isAbsolute(bundled)).toBe(true);
  });

  it("reports an FFmpeg that cannot be started, and one that fails", async () => {
    const missing = await startFfmpeg(["-version"], {
      purpose: "for this test",
      timeoutMs: 5000,
      executable: path.join(os.tmpdir(), "no-such-ffmpeg-here"),
    }).catch((error: unknown) => error);
    expect(missing).toBeInstanceOf(HttpError);
    expect((missing as HttpError).code).toBe("ffmpeg_missing");
    expect((missing as HttpError).message).toContain("for this test");

    const failed = await runFfmpeg(["-hide_banner", "-i", "no-such-input.wav", "-f", "null", "-"], {
      purpose: "for this test",
      timeoutMs: 10_000,
    }).catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(FfmpegError);
    expect((failed as FfmpegError).message).toContain("no-such-input.wav");
  });

  it("converts a WAV clip to MP3", async () => {
    const mp3 = await wavToMp3(silentWav());
    // An MP3 opens with an ID3 tag or a frame sync.
    expect(mp3.subarray(0, 3).toString("latin1") === "ID3" || mp3[0] === 0xff).toBe(true);
  }, 20_000);

  it("encodes PNG frames on stdin to an H.264 MP4", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-ffmpeg-"));
    try {
      const file = path.join(dir, "out.mp4");
      const run = await startFfmpeg(encodeArgs(10, file), {
        purpose: "for this test",
        timeoutMs: 20_000,
      });
      // Odd dimensions: the encoder pads them to even ones.
      for (let frame = 0; frame < 10; frame += 1) await run.write(imagePng(33, 21));
      await run.finish();
      expect(inspectMp4(await fs.readFile(file)).bytes).toBeGreaterThan(0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
