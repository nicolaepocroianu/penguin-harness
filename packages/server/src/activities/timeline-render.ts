/**
 * Rendering a scene video's timeline (see video-timeline.ts) with FFmpeg: one command whose
 * filter graph puts the whole video together.
 *
 * - Every cut is trimmed from its recording, brought to the timeline's size (letterboxed, never
 *   stretched) and frame rate, and joined to the one before: straight on, or crossfaded (`xfade`)
 *   where it fades in, starting where `cutStarts` says.
 * - Narration and effects are delayed to their start; the music is looped when its asset loops,
 *   faded in and out, and, when it ducks, turned down by a side-chain compressor keyed on the
 *   narration. Everything is mixed, padded or cut to the video's length, and brought to
 *   -16 LUFS (`loudnorm`).
 * - The video is H.264 and the audio AAC in an MP4; a timeline with no audio has no audio track.
 *
 * The steps follow what OpenMontage's FFmpeg tools do (video_compose, video_stitch,
 * audio_mixer), as ideas only; the command is Penguin's own.
 */
import type { MediaAsset } from "./media.js";
import { cutStarts, timelineLengthMs } from "./video-timeline.js";
import type { VideoTimeline } from "./video-timeline-types.js";

/** The LUFS a finished video's audio is brought to. */
export const TARGET_LOUDNESS = -16;

/** The files a timeline's render reads: each cut's recording, and each audio asset's clip. */
export interface TimelineInputs {
  /** The recording of each cut, in the timeline's order. */
  cuts: string[];
  /** The clip of each audio asset the timeline names, by key. */
  audio: Map<string, string>;
  /** The audio assets of the timeline's language, for whether music loops. */
  assets: MediaAsset[];
}

/** Seconds, as FFmpeg reads them, from milliseconds. */
function seconds(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(3);
}

/** Audio as every branch of the mix takes it: 48 kHz stereo. */
const AUDIO_FORMAT = "aformat=sample_rates=48000:channel_layouts=stereo";

/**
 * FFmpeg's arguments for rendering `timeline` from `inputs` to an MP4 at `file`. Pure: it reads
 * nothing, so a test can check the graph without FFmpeg.
 */
export function timelineRenderArgs(
  timeline: VideoTimeline,
  inputs: TimelineInputs,
  file: string,
): string[] {
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  const filters: string[] = [];
  let input = 0;
  const { width, height, fps } = timeline;
  const lengthMs = timelineLengthMs(timeline);
  const length = seconds(lengthMs);

  // The picture: each cut from its own input, then joined in order.
  const starts = cutStarts(timeline);
  let video = "";
  timeline.cuts.forEach((cut, index) => {
    args.push("-i", inputs.cuts[index]!);
    const label = `c${index}`;
    filters.push(
      `[${input}:v]trim=start=${seconds(cut.inMs)}:end=${seconds(cut.outMs)},setpts=PTS-STARTPTS,` +
        `fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p,settb=AVTB[${label}]`,
    );
    input += 1;
    if (index === 0) {
      video = label;
      return;
    }
    const joined = `v${index}`;
    filters.push(
      cut.transition === "cut"
        ? `[${video}][${label}]concat=n=2:v=1:a=0[${joined}]`
        : `[${video}][${label}]xfade=transition=${cut.transition}:` +
            `duration=${seconds(cut.transitionMs)}:offset=${seconds(starts[index]!)}[${joined}]`,
    );
    video = joined;
  });

  // The sound: narration, music and effects, each from its own input.
  const clip = (key: string, loop = false) => {
    if (loop) args.push("-stream_loop", "-1");
    args.push("-i", inputs.audio.get(key)!);
    return input++;
  };
  const narration = timeline.narration.map((entry, index) => {
    const label = `n${index}`;
    filters.push(
      `[${clip(entry.asset)}:a]${AUDIO_FORMAT},adelay=${Math.round(entry.startMs)}:all=1[${label}]`,
    );
    return label;
  });
  const mix: string[] = [];
  let speechKey: string | null = null;
  if (narration.length) {
    const ducked = !!timeline.music?.duck;
    filters.push(
      `${narration.map((label) => `[${label}]`).join("")}amix=inputs=${narration.length}:` +
        `normalize=0:dropout_transition=0${ducked ? ",asplit=2[speech][speechkey]" : "[speech]"}`,
    );
    mix.push("speech");
    if (ducked) speechKey = "speechkey";
  }
  if (timeline.music) {
    const { asset, volume, fadeInMs, fadeOutMs } = timeline.music;
    const loops = inputs.assets.find((entry) => entry.key === asset)?.loop === true;
    const fadeOut = Math.min(fadeOutMs, lengthMs);
    filters.push(
      `[${clip(asset, loops)}:a]${AUDIO_FORMAT},atrim=0:${length},asetpts=PTS-STARTPTS,` +
        `volume=${volume},afade=t=in:d=${seconds(Math.min(fadeInMs, lengthMs))},` +
        `afade=t=out:st=${seconds(lengthMs - fadeOut)}:d=${seconds(fadeOut)}[music]`,
    );
    if (speechKey) {
      filters.push(
        "[music][speechkey]sidechaincompress=threshold=0.02:ratio=10:attack=20:release=400[ducked]",
      );
      mix.push("ducked");
    } else mix.push("music");
  }
  timeline.effects.forEach((effect, index) => {
    const label = `e${index}`;
    filters.push(
      `[${clip(effect.asset)}:a]${AUDIO_FORMAT},volume=${effect.volume},` +
        `adelay=${Math.round(effect.startMs)}:all=1[${label}]`,
    );
    mix.push(label);
  });
  if (mix.length)
    filters.push(
      `${mix.map((label) => `[${label}]`).join("")}amix=inputs=${mix.length}:normalize=0:` +
        `dropout_transition=0,apad,atrim=0:${length},` +
        `loudnorm=I=${TARGET_LOUDNESS}:TP=-1.5:LRA=11,${AUDIO_FORMAT}[aout]`,
    );

  args.push("-filter_complex", filters.join(";"), "-map", `[${video}]`);
  if (mix.length) args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "160k");
  else args.push("-an");
  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(fps),
    "-t",
    length,
    "-movflags",
    "+faststart",
    file,
  );
  return args;
}
