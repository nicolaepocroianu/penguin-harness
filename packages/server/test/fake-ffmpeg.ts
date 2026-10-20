/**
 * A fake FFmpeg for the deploy's media optimisation: it describes each input as it is told to
 * (`ffmpeg -i`, the text the real one writes), and a re-encode writes the file it is told to
 * and, from then on, describes that input as optimised. Nothing runs a program.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { DeployProcess, DeployProcessResult } from "../src/activities/deploy-process.js";

const head = (format: string, bitrate: number) =>
  `Input #0, ${format}, from 'file':\n  Duration: 00:00:01.00, start: 0.000000, bitrate: ${bitrate} kb/s\n`;

/** An MP3 as a deploy ships it: mono, 44.1 kHz, 64 kb/s. */
export const MP3_OPTIMISED = `${head("mp3", 64)}  Stream #0:0: Audio: mp3 (mp3float), 44100 Hz, mono, fltp, 64 kb/s\n`;
/** A stereo MP3 at 128 kb/s. */
export const MP3_STEREO = `${head("mp3", 128)}  Stream #0:0: Audio: mp3 (mp3float), 44100 Hz, stereo, fltp, 128 kb/s\n`;
/** An MP3 at `kbps`, otherwise as a deploy ships it. */
export const mp3At = (kbps: number) =>
  `${head("mp3", kbps)}  Stream #0:0: Audio: mp3 (mp3float), 44100 Hz, mono, fltp, ${kbps} kb/s\n`;

/** A video as a deploy ships it: H.264 yuv420p, 29.97 fps, 900 kb/s, AAC mono 64 kb/s. */
export const MP4_OPTIMISED =
  `${head("mov,mp4,m4a,3gp,3g2,mj2", 970)}` +
  "  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 640x360 [SAR 1:1 DAR 16:9], 900 kb/s, 29.97 fps, 29.97 tbr, 30k tbn (default)\n" +
  "  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, mono, fltp, 64 kb/s (default)\n";
/** A 60 fps video at 4 Mb/s with stereo sound. */
export const MP4_LARGE =
  `${head("mov,mp4,m4a,3gp,3g2,mj2", 4200)}` +
  "  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1920x1080, 4000 kb/s, 60 fps, 60 tbr, 15360 tbn (default)\n" +
  "  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s (default)\n";

/**
 * The start of an .mp4 as FFmpeg writes one with fast start: an `ftyp` box with four
 * compatible brands, the index, then the data.
 */
export function mp4Bytes(brands = ["isom", "iso2", "avc1", "mp41"], body = 64): Buffer {
  const ftyp = Buffer.alloc(16 + brands.length * 4);
  ftyp.writeUInt32BE(ftyp.length, 0);
  ftyp.write("ftyp", 4, "latin1");
  ftyp.write("isom", 8, "latin1");
  ftyp.writeUInt32BE(0x200, 12);
  brands.forEach((brand, i) => ftyp.write(brand, 16 + i * 4, "latin1"));
  return Buffer.concat([
    ftyp,
    Buffer.from("\0\0\0\x08moov\0\0\0\x08mdat", "latin1"),
    Buffer.alloc(body),
  ]);
}

export interface FakeMedia {
  /** What `ffmpeg -i` writes of it; absent, it cannot be read. */
  describe?: string;
  /** What it is described as once re-encoded; absent, as a deploy ships its kind. */
  after?: string;
  /** How its re-encode ends: the exit code (0 unless said) and what FFmpeg wrote. */
  exitCode?: number;
  output?: string;
  /** What the re-encode writes; absent, a little audio, or an .mp4's boxes. */
  writes?: Buffer | string;
}

/**
 * A fake FFmpeg. `media` says of each input, by the end of its path (`loom/a.mp3`), what it
 * is; an input it does not know is described by `fallback`.
 */
export function fakeFfmpeg(media: Record<string, FakeMedia> = {}, fallback: FakeMedia = {}) {
  const calls: string[][] = [];
  const encoded = new Set<string>();
  let missing = false;
  const entryOf = (file: string): [string, FakeMedia] => {
    const normal = file.split(path.sep).join("/");
    const key = Object.keys(media).find((name) => normal.endsWith(`/${name}`));
    return key ? [key, media[key]!] : [normal, fallback];
  };
  async function ffmpeg(
    args: string[],
    onOutput: (text: string) => void,
  ): Promise<DeployProcessResult> {
    calls.push(args);
    if (missing) return { code: null, tail: "spawn ffmpeg ENOENT", error: "not_found" };
    const source = args[args.indexOf("-i") + 1]!;
    const [key, entry] = entryOf(source);
    const output = args.at(-1)!;
    if (output === source) {
      // Only described: FFmpeg wants an output, and says so with exit code 1.
      const text = encoded.has(key)
        ? (entry.after ?? (source.endsWith(".mp3") ? MP3_OPTIMISED : MP4_OPTIMISED))
        : entry.describe;
      const said = text
        ? `${text}At least one output file must be specified\n`
        : `${source}: Invalid data found when processing input\n`;
      onOutput(said);
      return { code: 1, tail: said };
    }
    if (entry.exitCode) {
      const said = entry.output ?? "Conversion failed!\n";
      onOutput(said);
      await fs.writeFile(output, "half a file");
      return { code: entry.exitCode, tail: said };
    }
    await fs.writeFile(
      output,
      entry.writes ?? (output.endsWith(".mp4") ? mp4Bytes() : Buffer.from("small")),
    );
    encoded.add(key);
    return { code: 0, tail: "" };
  }
  return {
    calls,
    ffmpeg,
    /** The deploy's process port, answering `command` as this FFmpeg. */
    process(command = "ffmpeg"): DeployProcess {
      return {
        async run(program, args, options) {
          if (program !== command) return { code: 0, tail: "" };
          return ffmpeg(args, options.onOutput ?? (() => {}));
        },
      };
    },
    /** From now on FFmpeg cannot be started. */
    remove() {
      missing = true;
    },
    /** The re-encodes asked for, by their input. */
    encodes(): string[] {
      return calls
        .filter((args) => args.at(-1) !== args[args.indexOf("-i") + 1])
        .map((args) => args[args.indexOf("-i") + 1]!.split(path.sep).join("/"));
    },
  };
}
