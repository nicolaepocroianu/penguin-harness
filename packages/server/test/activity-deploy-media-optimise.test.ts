/**
 * Re-encoding a QA deploy's media as Loom's deploy did: which files are re-encoded, the limits
 * a file already as a deploy ships it stays within, that a second pass re-encodes nothing, and
 * that a missing FFmpeg or a failed encode leaves every original as it was. FFmpeg is a fake
 * (`fake-ffmpeg.ts`) except in the last test, which runs the real one and skips without it.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FfmpegUnavailable,
  audioIsOptimised,
  brandsOk,
  optimiseMedia,
  parseProbe,
  videoArgs,
  videoIsOptimised,
} from "../src/activities/deploy-media-optimise.js";
import { spawnDeployProcess } from "../src/activities/deploy-process.js";
import { ffmpegPath } from "../src/activities/ffmpeg.js";
import {
  MP3_OPTIMISED,
  MP3_STEREO,
  MP4_LARGE,
  MP4_OPTIMISED,
  fakeFfmpeg,
  mp3At,
  mp4Bytes,
} from "./fake-ffmpeg.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

async function tempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

async function put(root: string, relative: string, content: string | Buffer) {
  const file = path.join(root, ...relative.split("/"));
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

const read = (root: string, relative: string) =>
  fs.readFile(path.join(root, ...relative.split("/")));

async function setup() {
  return {
    dir: await tempDir("wafh-optimise-clone-"),
    workDir: await tempDir("wafh-optimise-work-"),
  };
}

describe("deploy media optimisation", () => {
  it("re-encodes the audio and video not yet as a deploy ships them, and leaves the rest", async () => {
    const { dir, workDir } = await setup();
    await put(dir, "loom/w/big.mp3", Buffer.alloc(4000, 1));
    await put(dir, "loom/w/small.mp3", Buffer.alloc(500, 1));
    await put(dir, "loom/w/clip.mp4", mp4Bytes(undefined, 9000));
    await put(dir, "loom/w/picture.png", "png");
    const ffmpeg = fakeFfmpeg({
      "big.mp3": { describe: MP3_STEREO, writes: Buffer.alloc(1000, 2) },
      "small.mp3": { describe: MP3_OPTIMISED },
      "clip.mp4": { describe: MP4_LARGE },
    });
    const lines: string[] = [];
    const report = await optimiseMedia(
      {
        dir,
        workDir,
        // The same file named twice is looked at once; a file outside the working tree is left.
        paths: [
          "loom/w/big.mp3",
          "loom/w/big.mp3",
          "loom/w/small.mp3",
          "loom/w/clip.mp4",
          "loom/w/picture.png",
          "loom/w/elsewhere.mp3",
        ],
      },
      { ffmpeg: ffmpeg.ffmpeg, log: (text) => lines.push(text) },
    );
    expect(report.files.map((file) => [file.path, file.status])).toEqual([
      ["loom/w/big.mp3", "optimised"],
      ["loom/w/small.mp3", "already_optimised"],
      ["loom/w/clip.mp4", "optimised"],
      ["loom/w/picture.png", "skipped_other"],
      ["loom/w/elsewhere.mp3", "skipped_not_local"],
    ]);
    expect(report).toMatchObject({ optimised: 2, alreadyOptimised: 1, skipped: 2, failed: 0 });
    const clip = mp4Bytes(undefined, 9000).length;
    expect(report.files[0]).toMatchObject({ bytesBefore: 4000, bytesAfter: 1000 });
    expect(report.bytesBefore).toBe(4000 + clip);
    expect(report.bytesAfter).toBe(1000 + mp4Bytes().length);
    expect((await read(dir, "loom/w/big.mp3")).equals(Buffer.alloc(1000, 2))).toBe(true);
    expect(await read(dir, "loom/w/small.mp3")).toEqual(Buffer.alloc(500, 1));
    expect(ffmpeg.encodes().map((file) => path.basename(file))).toEqual(["big.mp3", "clip.mp4"]);

    // Loom's settings: LAME 64 kb/s mono 44.1 kHz, no Xing header, no ID3v2 tag.
    const audio = ffmpeg.calls.find((args) => args.includes("libmp3lame"))!;
    expect(audio.slice(audio.indexOf("-map"), -1)).toEqual([
      "-map",
      "0:a:0",
      "-vn",
      "-sn",
      "-dn",
      "-ac",
      "1",
      "-ar",
      "44100",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "64k",
      "-write_xing",
      "0",
      "-id3v2_version",
      "0",
    ]);
    // A 60 fps video is brought down to 30000/1001 fps.
    const video = ffmpeg.calls.find((args) => args.includes("libx264"))!;
    expect(video.slice(video.indexOf("-map"), -1)).toEqual([
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-dn",
      "-sn",
      "-vf",
      "fps=30000/1001",
      "-c:v",
      "libx264",
      "-b:v",
      "1000k",
      "-maxrate",
      "1500k",
      "-bufsize",
      "3000k",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart+use_metadata_tags",
      "-metadata",
      "compatible_brands=mp42iso2avc1mp41",
      "-metadata",
      "encoded_by=Waterford Media Framework",
      "-c:a",
      "aac",
      "-b:a",
      "64k",
      "-ac",
      "1",
      "-ar",
      "44100",
    ]);
    // FFmpeg writes only into the work folder.
    expect(audio.at(-1)!.startsWith(workDir)).toBe(true);
    expect(video.at(-1)!.startsWith(workDir)).toBe(true);
    expect(await fs.readdir(workDir)).toEqual([]);

    // The .mp4 has the brands the media repository's validator asks for.
    const ftyp = (await read(dir, "loom/w/clip.mp4")).subarray(8, 32).toString("latin1");
    expect(ftyp.slice(0, 4)).toBe("mp42");
    expect(ftyp.slice(8)).toBe("mp42iso2avc1mp41");

    expect(lines).toContain(`Optimised loom/w/big.mp3: 3.9 KB → 1000 B (saved 2.9 KB, 75%).`);
    expect(lines.at(-1)).toMatch(
      /^Media optimisation: 2 re-encoded, 1 already optimised, 2 skipped, 0 failed\. .* → .* \(saved .*\)\.$/,
    );
  });

  it("re-encodes nothing the second time", async () => {
    const { dir, workDir } = await setup();
    await put(dir, "loom/w/a.mp3", Buffer.alloc(3000, 1));
    await put(dir, "loom/w/b.mp4", mp4Bytes(undefined, 3000));
    const ffmpeg = fakeFfmpeg({
      "a.mp3": { describe: MP3_STEREO },
      "b.mp4": { describe: MP4_LARGE },
    });
    const input = { dir, workDir, paths: ["loom/w/a.mp3", "loom/w/b.mp4"] };
    const ports = { ffmpeg: ffmpeg.ffmpeg, log: () => {} };
    expect((await optimiseMedia(input, ports)).optimised).toBe(2);
    const after = await Promise.all([read(dir, "loom/w/a.mp3"), read(dir, "loom/w/b.mp4")]);
    const again = await optimiseMedia(input, ports);
    expect(again).toMatchObject({ optimised: 0, alreadyOptimised: 2, bytesBefore: 0 });
    expect(ffmpeg.encodes()).toHaveLength(2);
    expect(await Promise.all([read(dir, "loom/w/a.mp3"), read(dir, "loom/w/b.mp4")])).toEqual(
      after,
    );
  });

  it("leaves the original as it was when an encode fails, and names why", async () => {
    const { dir, workDir } = await setup();
    await put(dir, "loom/w/bad.mp3", "original");
    await put(dir, "loom/w/unreadable.mp3", "noise");
    const ffmpeg = fakeFfmpeg({
      "bad.mp3": { describe: MP3_STEREO, exitCode: 1, output: "Error while encoding\n" },
      "unreadable.mp3": {},
    });
    const lines: string[] = [];
    const report = await optimiseMedia(
      { dir, workDir, paths: ["loom/w/bad.mp3", "loom/w/unreadable.mp3"] },
      { ffmpeg: ffmpeg.ffmpeg, log: (text) => lines.push(text) },
    );
    expect(report.files).toMatchObject([
      { path: "loom/w/bad.mp3", status: "failed", reason: "Error while encoding" },
      { path: "loom/w/unreadable.mp3", status: "failed" },
    ]);
    expect(report.files[1]!.reason).toMatch(/Invalid data/);
    expect(report.failed).toBe(2);
    expect((await read(dir, "loom/w/bad.mp3")).toString()).toBe("original");
    // Nothing is left beside it, and the half-written output is gone.
    expect((await fs.readdir(path.join(dir, "loom/w"))).sort()).toEqual([
      "bad.mp3",
      "unreadable.mp3",
    ]);
    expect(await fs.readdir(workDir)).toEqual([]);
    expect(lines).toContain("Could not optimise loom/w/bad.mp3: Error while encoding");
  });

  it("fails a re-encoded .mp4 whose ftyp box has no room for the validator's brands", async () => {
    const { dir, workDir } = await setup();
    await put(dir, "loom/w/v.mp4", mp4Bytes(undefined, 100));
    const ffmpeg = fakeFfmpeg({ "v.mp4": { describe: MP4_LARGE, writes: mp4Bytes(["isom"]) } });
    const report = await optimiseMedia(
      { dir, workDir, paths: ["loom/w/v.mp4"] },
      { ffmpeg: ffmpeg.ffmpeg, log: () => {} },
    );
    expect(report.files[0]).toMatchObject({ status: "failed" });
    expect(report.files[0]!.reason).toMatch(/1 compatible brand slots; 4 are needed/);
    expect(await read(dir, "loom/w/v.mp4")).toEqual(mp4Bytes(undefined, 100));
  });

  it("stops at once, re-encoding nothing, when FFmpeg cannot be started", async () => {
    const { dir, workDir } = await setup();
    await put(dir, "loom/w/a.mp3", "original");
    const ffmpeg = fakeFfmpeg({ "a.mp3": { describe: MP3_STEREO } });
    ffmpeg.remove();
    await expect(
      optimiseMedia(
        { dir, workDir, paths: ["loom/w/a.mp3"] },
        { ffmpeg: ffmpeg.ffmpeg, log: () => {} },
      ),
    ).rejects.toBeInstanceOf(FfmpegUnavailable);
    expect((await read(dir, "loom/w/a.mp3")).toString()).toBe("original");
  });

  it("never re-encodes through a link", async () => {
    const { dir, workDir } = await setup();
    const outside = await tempDir("wafh-optimise-outside-");
    await put(outside, "real.mp3", "outside");
    await fs.mkdir(path.join(dir, "loom"), { recursive: true });
    try {
      await fs.symlink(path.join(outside, "real.mp3"), path.join(dir, "loom", "link.mp3"));
    } catch {
      return; // This machine cannot make links without privileges.
    }
    const ffmpeg = fakeFfmpeg({}, { describe: MP3_STEREO });
    const report = await optimiseMedia(
      { dir, workDir, paths: ["loom/link.mp3"] },
      { ffmpeg: ffmpeg.ffmpeg, log: () => {} },
    );
    expect(report.files[0]!.status).toBe("skipped_not_local");
    expect(ffmpeg.calls).toEqual([]);
  });
});

describe("what may go wrong around an encode", () => {
  it("never overwrites a file that changed in the clone while it was re-encoded", async () => {
    const { dir, workDir } = await setup();
    await put(dir, "loom/w/take.mp3", "the old take");
    const ffmpeg = fakeFfmpeg({
      "take.mp3": {
        describe: MP3_STEREO,
        // An accepted take is written into the clone while FFmpeg works on the old one.
        meanwhile: (source) => fs.writeFile(source, "the take accepted meanwhile"),
      },
    });
    const report = await optimiseMedia(
      { dir, workDir, paths: ["loom/w/take.mp3"] },
      { ffmpeg: ffmpeg.ffmpeg, log: () => {} },
    );
    expect(report.files[0]).toMatchObject({ status: "failed", problem: "changed" });
    expect(report.files[0]!.reason).toMatch(/changed in the media clone while it was re-encoded/);
    expect((await read(dir, "loom/w/take.mp3")).toString()).toBe("the take accepted meanwhile");
    expect(await fs.readdir(path.join(dir, "loom/w"))).toEqual(["take.mp3"]);
  });

  it("gives an otherwise optimised .mp4 the validator's brands by copying its streams, never encoding it again", async () => {
    const { dir, workDir } = await setup();
    await put(dir, "loom/w/plain.mp4", mp4Bytes(["isom", "iso2", "avc1", "mp41"], 500));
    const ffmpeg = fakeFfmpeg({ "plain.mp4": { describe: MP4_OPTIMISED } });
    const lines: string[] = [];
    const ports = { ffmpeg: ffmpeg.ffmpeg, log: (text: string) => lines.push(text) };
    const input = { dir, workDir, paths: ["loom/w/plain.mp4"] };
    const report = await optimiseMedia(input, ports);
    expect(report).toMatchObject({ optimised: 0, rebranded: 1, failed: 0 });
    expect(report.files[0]!.status).toBe("rebranded");
    const remux = ffmpeg.calls.at(-1)!;
    expect(remux).toContain("copy");
    expect(remux).not.toContain("libx264");
    expect(remux).toContain("compatible_brands=mp42iso2avc1mp41");
    expect(brandsOk(await read(dir, "loom/w/plain.mp4"))).toBe(true);
    expect(lines).toContain("Gave loom/w/plain.mp4 the validator's MP4 brands.");
    // Once branded it is left alone.
    expect((await optimiseMedia(input, ports)).alreadyOptimised).toBe(1);
    expect(ffmpeg.encodes()).toHaveLength(1);
    // A .mov is never given MP4 brands.
    await put(dir, "loom/w/plain.mov", mp4Bytes(["qt  "], 500));
    const mov = fakeFfmpeg({ "plain.mov": { describe: MP4_OPTIMISED } });
    const movReport = await optimiseMedia(
      { dir, workDir, paths: ["loom/w/plain.mov"] },
      { ffmpeg: mov.ffmpeg, log: () => {} },
    );
    expect(movReport.alreadyOptimised).toBe(1);
  });

  it("fails a file the clone has only as a Git LFS pointer, without asking FFmpeg", async () => {
    const { dir, workDir } = await setup();
    await put(
      dir,
      "loom/w/pointer.mp3",
      "version https://git-lfs.github.com/spec/v1\noid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393\nsize 12345\n",
    );
    const ffmpeg = fakeFfmpeg({}, { describe: MP3_STEREO });
    const report = await optimiseMedia(
      { dir, workDir, paths: ["loom/w/pointer.mp3"] },
      { ffmpeg: ffmpeg.ffmpeg, log: () => {} },
    );
    expect(report.files[0]).toMatchObject({ status: "failed", problem: "lfs_pointer" });
    expect(ffmpeg.calls).toEqual([]);
  });

  it.skipIf(process.getuid?.() === 0)(
    "names the OS error when the re-encoded copy cannot be put in place, and keeps the original",
    async () => {
      const { dir, workDir } = await setup();
      await put(dir, "loom/w/locked.mp3", "original");
      const folder = path.join(dir, "loom", "w");
      const file = path.join(folder, "locked.mp3");
      // Windows refuses to rename over a read-only file; elsewhere the folder is made read-only.
      const lock = (on: boolean) =>
        process.platform === "win32"
          ? fs.chmod(file, on ? 0o444 : 0o666)
          : fs.chmod(folder, on ? 0o555 : 0o755);
      const ffmpeg = fakeFfmpeg({
        "locked.mp3": { describe: MP3_STEREO, meanwhile: () => lock(true) },
      });
      try {
        const report = await optimiseMedia(
          { dir, workDir, paths: ["loom/w/locked.mp3"] },
          { ffmpeg: ffmpeg.ffmpeg, log: () => {} },
        );
        expect(report.files[0]).toMatchObject({ status: "failed", problem: "write" });
        expect(report.files[0]!.reason).toMatch(/^(EPERM|EACCES): /);
      } finally {
        await lock(false);
      }
      expect((await read(dir, "loom/w/locked.mp3")).toString()).toBe("original");
      expect(await fs.readdir(folder)).toEqual(["locked.mp3"]);
    },
  );

  it("keeps a failure's reason short, its progress lines broken at their carriage returns", async () => {
    const { dir, workDir } = await setup();
    await put(dir, "loom/w/noisy.mp3", "original");
    const progress = Array.from({ length: 3000 }, (_, i) => `frame=${i} size=${i}kB\r`).join("");
    const ffmpeg = fakeFfmpeg({
      "noisy.mp3": {
        describe: MP3_STEREO,
        exitCode: 1,
        output: `${progress}\nError while encoding\n`,
      },
    });
    const report = await optimiseMedia(
      { dir, workDir, paths: ["loom/w/noisy.mp3"] },
      { ffmpeg: ffmpeg.ffmpeg, log: () => {} },
    );
    const reason = report.files[0]!.reason!;
    expect(reason.length).toBeLessThanOrEqual(2001);
    expect(reason).not.toContain("\r");
    expect(reason.endsWith("Error while encoding")).toBe(true);
    // FFmpeg is told to write no progress and only its errors while it encodes.
    const encode = ffmpeg.calls.at(-1)!;
    expect(encode.slice(0, 6)).toEqual([
      "-hide_banner",
      "-nostdin",
      "-nostats",
      "-loglevel",
      "error",
      "-y",
    ]);
  });

  it("fails a re-encoded .mp4 whose ftyp box claims more than the file holds", async () => {
    const { dir, workDir } = await setup();
    await put(dir, "loom/w/v.mp4", mp4Bytes(undefined, 100));
    const broken = mp4Bytes();
    broken.writeUInt32BE(0xfffffff0, 0);
    const ffmpeg = fakeFfmpeg({ "v.mp4": { describe: MP4_LARGE, writes: broken } });
    const report = await optimiseMedia(
      { dir, workDir, paths: ["loom/w/v.mp4"] },
      { ffmpeg: ffmpeg.ffmpeg, log: () => {} },
    );
    expect(report.files[0]).toMatchObject({ status: "failed", problem: "ffmpeg" });
    expect(report.files[0]!.reason).toMatch(/cannot be right/);
    expect(await read(dir, "loom/w/v.mp4")).toEqual(mp4Bytes(undefined, 100));
  });
});

describe("the validator's MP4 brands", () => {
  it("are major brand mp42 and compatible brands mp42 iso2 avc1 mp41, in that order, empty slots aside", () => {
    const patched = mp4Bytes(["mp42", "iso2", "avc1", "mp41", "\0\0\0\0"]);
    patched.write("mp42", 8, "latin1");
    expect(brandsOk(patched)).toBe(true);
    expect(brandsOk(mp4Bytes())).toBe(false); // major brand isom
    const reordered = mp4Bytes(["iso2", "mp42", "avc1", "mp41"]);
    reordered.write("mp42", 8, "latin1");
    expect(brandsOk(reordered)).toBe(false);
    const extra = mp4Bytes(["mp42", "iso2", "avc1", "mp41", "dash"]);
    extra.write("mp42", 8, "latin1");
    expect(brandsOk(extra)).toBe(false);
    expect(brandsOk(Buffer.from("not an mp4"))).toBe(false);
  });
});

describe("what counts as already optimised (Loom's limits)", () => {
  const plain = Buffer.from("plain audio frames");

  it("keeps an MP3 up to 5% over 64 kb/s, mono, 44.1 kHz, with no ID3v2 tag or Xing/Info header", () => {
    expect(audioIsOptimised(parseProbe(MP3_OPTIMISED), plain)).toBe(true);
    expect(audioIsOptimised(parseProbe(mp3At(67)), plain)).toBe(true);
    expect(audioIsOptimised(parseProbe(mp3At(68)), plain)).toBe(false);
    expect(audioIsOptimised(parseProbe(MP3_STEREO), plain)).toBe(false);
    expect(audioIsOptimised(parseProbe(MP3_OPTIMISED.replace("44100 Hz", "48000 Hz")), plain)).toBe(
      false,
    );
    expect(audioIsOptimised(parseProbe(MP3_OPTIMISED), Buffer.from("ID3\x04 tag"))).toBe(false);
    expect(audioIsOptimised(parseProbe(MP3_OPTIMISED), Buffer.from("....Xing...."))).toBe(false);
    expect(audioIsOptimised(parseProbe(MP3_OPTIMISED), Buffer.from("....Info...."))).toBe(false);
    // Cover art is a second stream: dropped by a re-encode.
    const withArt = `${MP3_OPTIMISED}  Stream #0:1: Video: mjpeg (Baseline), yuvj420p(pc), 300x300, 90k tbr, 90k tbn (attached pic)\n`;
    expect(audioIsOptimised(parseProbe(withArt), plain)).toBe(false);
  });

  it("falls back to the file's bitrate for audio, never for video", () => {
    const noStreamRate = MP3_OPTIMISED.replace(", 64 kb/s\n", "\n").replace(
      "bitrate: 64",
      "bitrate: 128",
    );
    expect(audioIsOptimised(parseProbe(noStreamRate), plain)).toBe(false);
    const video = MP4_OPTIMISED.replace(", 900 kb/s", "").replace("bitrate: 970", "bitrate: 5000");
    expect(videoIsOptimised(parseProbe(video), mp4Bytes())).toBe(true);
  });

  it("keeps an H.264 yuv420p video up to 1050 kb/s and 30000/1001 fps, fast start, AAC mono", () => {
    const ok = parseProbe(MP4_OPTIMISED);
    expect(ok.streams).toMatchObject([
      { type: "video", codec: "h264", pixelFormat: "yuv420p", fps: 29.97, bitRate: 900_000 },
      { type: "audio", codec: "aac", channels: 1, sampleRate: 44_100, bitRate: 64_000 },
    ]);
    expect(videoIsOptimised(ok, mp4Bytes())).toBe(true);
    const variant = (from: string, to: string) => parseProbe(MP4_OPTIMISED.replace(from, to));
    expect(videoIsOptimised(variant("900 kb/s", "1050 kb/s"), mp4Bytes())).toBe(true);
    expect(videoIsOptimised(variant("900 kb/s", "1051 kb/s"), mp4Bytes())).toBe(false);
    expect(videoIsOptimised(variant("29.97 fps", "30 fps"), mp4Bytes())).toBe(false);
    expect(videoIsOptimised(variant("yuv420p(tv", "yuv444p(tv"), mp4Bytes())).toBe(false);
    expect(videoIsOptimised(variant("Video: h264", "Video: hevc"), mp4Bytes())).toBe(false);
    expect(videoIsOptimised(variant("mono", "stereo"), mp4Bytes())).toBe(false);
    // Data after the index is not fast start.
    const slow = Buffer.from("\0\0\0\x08mdat....\0\0\0\x08moov", "latin1");
    expect(videoIsOptimised(ok, slow)).toBe(false);
    const silent = parseProbe(
      MP4_OPTIMISED.split("\n")
        .filter((line) => !line.includes("Audio"))
        .join("\n"),
    );
    expect(videoIsOptimised(silent, mp4Bytes())).toBe(true);
    const subtitled = parseProbe(
      `${MP4_OPTIMISED}  Stream #0:2[0x3](eng): Subtitle: mov_text (tx3g / 0x67337874), 0 kb/s\n`,
    );
    expect(videoIsOptimised(subtitled, mp4Bytes())).toBe(false);
  });

  it("keeps the frame rate of a video at or below 30000/1001 fps", () => {
    const args = videoArgs("in.mp4", "out.mp4", parseProbe(MP4_OPTIMISED), ".mp4");
    expect(args).not.toContain("-vf");
    // A .mov gets no MP4 brands: the validator's brand fix looks at .mp4 files alone.
    const mov = videoArgs("in.mov", "out.mov", parseProbe(MP4_LARGE), ".mov");
    expect(mov).toContain("fps=30000/1001");
    expect(mov.slice(mov.indexOf("-movflags"), mov.indexOf("-movflags") + 2)).toEqual([
      "-movflags",
      "+faststart",
    ]);
    expect(mov).not.toContain("encoded_by=Waterford Media Framework");
  });
});

/** Whether a real FFmpeg can be run here. */
function realFfmpeg(): string | null {
  const command = ffmpegPath();
  const probe = spawnSync(command, ["-hide_banner", "-version"], { encoding: "utf8" });
  return probe.status === 0 ? command : null;
}

const ffmpeg = realFfmpeg();

describe.skipIf(!ffmpeg)("deploy media optimisation with the real FFmpeg", () => {
  it("re-encodes a stereo MP3 and a 60 fps video, and leaves both alone the second time", async () => {
    const { dir, workDir } = await setup();
    await fs.mkdir(path.join(dir, "loom"), { recursive: true });
    const make = (args: string[]) =>
      expect(spawnSync(ffmpeg!, ["-hide_banner", "-loglevel", "error", "-y", ...args]).status).toBe(
        0,
      );
    make([
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=2",
      "-ac",
      "2",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "192k",
      path.join(dir, "loom", "tone.mp3"),
    ]);
    // Already as a deploy ships it, but with FFmpeg's own brands.
    make([
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=160x120:rate=30000/1001:duration=1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1",
      "-c:v",
      "libx264",
      "-b:v",
      "300k",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-c:a",
      "aac",
      "-b:a",
      "64k",
      "-ac",
      "1",
      "-ar",
      "44100",
      "-shortest",
      path.join(dir, "loom", "plain.mp4"),
    ]);
    make([
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=160x120:rate=60:duration=1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv444p",
      "-c:a",
      "aac",
      "-ac",
      "2",
      "-shortest",
      path.join(dir, "loom", "clip.mp4"),
    ]);
    const ports = {
      ffmpeg: (args: string[], onOutput: (text: string) => void) =>
        spawnDeployProcess.run(ffmpeg!, args, { cwd: workDir, shell: false, onOutput }),
      log: () => {},
    };
    const input = { dir, workDir, paths: ["loom/tone.mp3", "loom/clip.mp4", "loom/plain.mp4"] };
    const first = await optimiseMedia(input, ports);
    expect(first.files.map((file) => [file.path, file.status, file.reason])).toEqual([
      ["loom/tone.mp3", "optimised", undefined],
      ["loom/clip.mp4", "optimised", undefined],
      ["loom/plain.mp4", "rebranded", undefined],
    ]);
    expect(brandsOk(await read(dir, "loom/plain.mp4"))).toBe(true);
    expect(first.files[0]!.bytesAfter!).toBeLessThan(first.files[0]!.bytesBefore!);
    const clip = await read(dir, "loom/clip.mp4");
    expect(clip.subarray(8, 12).toString("latin1")).toBe("mp42");
    const second = await optimiseMedia(input, ports);
    expect(second.files.map((file) => file.status)).toEqual([
      "already_optimised",
      "already_optimised",
      "already_optimised",
    ]);
    expect(await read(dir, "loom/clip.mp4")).toEqual(clip);
  }, 60_000);
});
