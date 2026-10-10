/**
 * A scene video's timeline (experimental). What this proves: a timeline's shape is checked and
 * a malformed one refused with what is wrong; fades overlap the cuts they join; what a timeline
 * refers to is reported, never refused; a default timeline places the scene's narration one
 * after another over its recording with its music turned down under them; captions are cut
 * from word timings by word count, length and sentence ends, and written as WebVTT; and the
 * media plan keeps a timeline on a video, refuses one elsewhere, and never ships it.
 */
import { describe, expect, it } from "vitest";
import { validateManifest, wafManifest, type MediaAsset } from "../src/activities/media.js";
import {
  captionCues,
  cutStarts,
  defaultTimeline,
  parseTimeline,
  timelineIssues,
  timelineLengthMs,
  webVtt,
} from "../src/activities/video-timeline.js";
import type { TimelineCut, VideoTimeline } from "../src/activities/video-timeline-types.js";

const RUN = `run_${"a".repeat(32)}`;
const SHA = "b".repeat(64);
const source = { runId: RUN, sha256: SHA, format: "mp4" as const };

function cut(id: string, inMs: number, outMs: number, fade = 0): TimelineCut {
  return {
    id,
    source,
    inMs,
    outMs,
    transition: fade ? "fade" : "cut",
    transitionMs: fade,
  };
}

function timeline(overrides: Partial<VideoTimeline> = {}): VideoTimeline {
  return {
    version: 1,
    width: 640,
    height: 480,
    fps: 30,
    cuts: [cut("cut-1", 0, 6000)],
    narration: [],
    music: null,
    effects: [],
    captions: { enabled: true, maxWords: 8, maxChars: 42 },
    ...overrides,
  };
}

const usage = (sceneId: string) => ({
  sceneId,
  sourceKey: "x",
  occurrence: 1,
  sceneOccurrenceCount: 1,
});

const words = (text: string, from = 0, each = 300) =>
  text.split(" ").map((word, index) => ({
    word,
    startMs: from + index * each,
    endMs: from + index * each + each - 50,
  }));

/** A scene's media: its video, two narrations (one timed), music, an effect, and another scene. */
function assets(): MediaAsset[] {
  return [
    { key: "intro-video", type: "video", description: "Sky", usages: [usage("intro")] },
    {
      key: "intro-line-1",
      type: "audio",
      description: "First line",
      script: "The sun comes up.",
      path: "media/loom/p/p-1/audio/english/intro-line-1.mp3",
      wordTimings: words("The sun comes up."),
      durationMs: 1500,
      usages: [usage("intro")],
    },
    {
      key: "intro-line-2",
      type: "audio",
      description: "Second line",
      script: "Birds start to sing in the trees",
      usages: [usage("intro")],
    },
    {
      key: "intro-music",
      type: "audio",
      description: "Calm music",
      kind: "music",
      channel: "music",
      loop: true,
      volume: 0.4,
      path: "media/loom/p/p-1/audio/english/intro-music.mp3",
      usages: [usage("intro")],
    },
    {
      key: "chirp",
      type: "audio",
      description: "A chirp",
      kind: "sfx",
      channel: "sfx",
      loop: false,
      volume: 1,
      path: "media/loom/p/p-1/audio/english/chirp.mp3",
      usages: [usage("intro")],
    },
    {
      key: "outro-line",
      type: "audio",
      description: "Elsewhere",
      script: "Goodbye.",
      usages: [usage("outro")],
    },
  ];
}

describe("video timelines", () => {
  it("reads a well-formed timeline back as it was", () => {
    const value = timeline({
      cuts: [cut("cut-1", 0, 3000), cut("cut-2", 1000, 4000, 500)],
      narration: [{ asset: "intro-line-1", startMs: 500 }],
      music: { asset: "intro-music", volume: 0.3, fadeInMs: 1000, fadeOutMs: 1000, duck: true },
      effects: [{ asset: "chirp", startMs: 2000, volume: 0.8 }],
    });
    expect(parseTimeline(JSON.parse(JSON.stringify(value)))).toEqual(value);
  });

  it("refuses a malformed timeline and says what is wrong", () => {
    const refused = (value: unknown) => {
      try {
        parseTimeline(value);
        return null;
      } catch (error) {
        return (error as Error).message;
      }
    };
    expect(refused(timeline({ cuts: [] }))).toContain("no cuts");
    expect(refused({ ...timeline(), version: 2 })).toContain("version");
    expect(refused({ ...timeline(), extra: true })).toContain('unknown field "extra"');
    expect(refused(timeline({ cuts: [cut("cut-1", 3000, 3000)] }))).toContain("end after");
    expect(refused(timeline({ cuts: [cut("a", 0, 1000), cut("a", 0, 1000)] }))).toContain(
      "share an id",
    );
    // The first cut has nothing to fade from; a fade cannot outlast a cut it joins.
    expect(refused(timeline({ cuts: [cut("cut-1", 0, 3000, 500)] }))).toContain("first cut");
    expect(
      refused(timeline({ cuts: [cut("cut-1", 0, 400), cut("cut-2", 0, 3000, 500)] })),
    ).toContain("longer than a cut");
    // A plain cut takes no time, and a fade some.
    expect(
      refused(
        timeline({
          cuts: [cut("cut-1", 0, 3000), { ...cut("cut-2", 0, 3000), transitionMs: 200 }],
        }),
      ),
    ).toContain("only a fade");
    expect(
      refused(
        timeline({ cuts: [{ ...cut("cut-1", 0, 3000), source: { ...source, runId: "x" } }] }),
      ),
    ).toContain("not a recording");
    expect(refused(timeline({ effects: [{ asset: "chirp", startMs: 0, volume: 2 }] }))).toContain(
      "from 0 to 1",
    );
    expect(refused(timeline({ narration: [{ asset: "../escape", startMs: 0 }] }))).toContain(
      "asset key",
    );
    const sixMinutes = 6 * 60_000;
    expect(
      refused(timeline({ cuts: [cut("cut-1", 0, sixMinutes), cut("cut-2", 0, sixMinutes)] })),
    ).toContain("longer than ten minutes");
  });

  it("starts each cut where the one before ends, less the fade that joins them", () => {
    const value = timeline({
      cuts: [cut("a", 0, 3000), cut("b", 0, 2000, 500), cut("c", 1000, 2000)],
    });
    expect(cutStarts(value)).toEqual([0, 2500, 4500]);
    expect(timelineLengthMs(value)).toBe(5500);
  });

  it("reports what a timeline refers to, without refusing it", () => {
    const value = timeline({
      cuts: [cut("cut-1", 0, 2000)],
      narration: [
        { asset: "intro-line-1", startMs: 0 },
        { asset: "intro-line-1", startMs: 1000 },
        { asset: "intro-line-2", startMs: 0 },
        { asset: "gone", startMs: 0 },
        { asset: "intro-music", startMs: 0 },
      ],
      music: { asset: "chirp", volume: 0.3, fadeInMs: 0, fadeOutMs: 0, duck: true },
      effects: [{ asset: "chirp", startMs: 2500, volume: 1 }],
    });
    expect(timelineIssues(value, assets())).toEqual([
      // The second narration starts before the first ends, and runs past the 2 s video.
      { code: "past_end", asset: "intro-line-1" },
      { code: "asset_unbound", asset: "intro-line-2" },
      { code: "asset_missing", asset: "gone" },
      { code: "asset_kind", asset: "intro-music" },
      { code: "narration_overlap", asset: "intro-line-1" },
      { code: "asset_kind", asset: "chirp" },
      { code: "past_end", asset: "chirp" },
    ]);
    const timed = assets().map((asset) =>
      asset.key === "intro-line-1" ? { ...asset, wordTimings: undefined, durationMs: 800 } : asset,
    );
    expect(
      timelineIssues(timeline({ narration: [{ asset: "intro-line-1", startMs: 0 }] }), timed),
    ).toEqual([{ code: "captions_untimed", asset: "intro-line-1" }]);
    expect(timelineIssues(timeline(), assets())).toEqual([]);
  });

  it("starts from the scene's recording, narration one after another, and its music ducked", () => {
    const value = defaultTimeline(assets(), "intro-video", {
      ...source,
      seconds: 6,
      width: 640,
      height: 480,
      fps: 30,
    });
    expect(value).toEqual(
      timeline({
        cuts: [cut("cut-1", 0, 6000)],
        // The first is 1.5 s long; the second has no length yet, so seven words are guessed.
        narration: [
          { asset: "intro-line-1", startMs: 500 },
          { asset: "intro-line-2", startMs: 500 + 1500 + 400 },
        ],
        music: { asset: "intro-music", volume: 0.4, fadeInMs: 1000, fadeOutMs: 1000, duck: true },
      }),
    );
    expect(parseTimeline(value)).toEqual(value);
  });

  it("cuts captions by words, length and sentence ends, and writes them as WebVTT", () => {
    const line: MediaAsset = {
      key: "line",
      type: "audio",
      description: "A line",
      script: "x",
      path: "media/x.mp3",
      wordTimings: words(
        "One two three four five six seven eight nine. A <tag> & more! Extraordinarily-long-words-take-their-own-caption here",
      ),
      usages: [],
    };
    const value = timeline({
      narration: [{ asset: "line", startMs: 1000 }],
      captions: { enabled: true, maxWords: 8, maxChars: 20 },
    });
    const cues = captionCues(value, [line]);
    expect(cues.map((cue) => cue.text)).toEqual([
      "One two three four",
      "five six seven eight",
      "nine.",
      "A <tag> & more!",
      "Extraordinarily-long-words-take-their-own-caption",
      "here",
    ]);
    // Placed on the timeline: the narration starts at 1 s, each word lasts 250 ms of 300; a
    // caption runs on to the next across the 50 ms between them.
    expect(cues[0]).toEqual({
      startMs: 1000,
      endMs: 1000 + 4 * 300,
      text: "One two three four",
    });
    expect(webVtt(cues.slice(3, 4))).toBe(
      "WEBVTT\n\n00:00:03.700 --> 00:00:04.900\nA &lt;tag&gt; &amp; more!\n",
    );
    expect(
      captionCues({ ...value, captions: { ...value.captions, enabled: false } }, [line]),
    ).toEqual([]);
  });

  it("keeps each caption up long enough to read, never over the next or past the end", () => {
    const line = (key: string): MediaAsset => ({
      key,
      type: "audio",
      description: "A line",
      script: "Hi.",
      path: `media/${key}.mp3`,
      wordTimings: words("Hi."),
      usages: [],
    });
    const cues = (starts: number[]) =>
      captionCues(
        timeline({
          cuts: [cut("cut-1", 0, 6000)],
          narration: starts.map((startMs, index) => ({ asset: `l${index}`, startMs })),
        }),
        starts.map((_, index) => line(`l${index}`)),
      ).map((cue) => [cue.startMs, cue.endMs]);
    // A one-word caption of 250 ms stays 1.2 s; the next one cuts it short; the video's end too.
    expect(cues([0, 3000])).toEqual([
      [0, 1200],
      [3000, 4200],
    ]);
    expect(cues([0, 800])).toEqual([
      [0, 800],
      [800, 2000],
    ]);
    // Under half a second apart: the first runs on to the second.
    expect(cues([0, 1500])).toEqual([
      [0, 1500],
      [1500, 2700],
    ]);
    expect(cues([5500])).toEqual([[5500, 6000]]);
  });

  it("takes each captioned word's punctuation from the script, and breaks at its sentences", () => {
    // ElevenLabs' timings, as test16's narration came back: no punctuation at all.
    const line: MediaAsset = {
      key: "line",
      type: "audio",
      description: "A line",
      script: "Each treasure is a letter. Listen — and find the right letter!",
      path: "media/x.mp3",
      wordTimings: words("Each treasure is a letter Listen and find the right letter"),
      usages: [],
    };
    const value = timeline({ narration: [{ asset: "line", startMs: 0 }] });
    expect(captionCues(value, [line]).map((cue) => cue.text)).toEqual([
      "Each treasure is a letter.",
      "Listen and find the right letter!",
    ]);
    // A timed word the script does not have keeps its own form.
    const odd = { ...line, wordTimings: words("Each treasure is a ladder") };
    expect(captionCues(value, [odd]).map((cue) => cue.text)).toEqual(["Each treasure is a ladder"]);
  });

  it("keeps a timeline on a video in the media plan, refuses one elsewhere, and never ships it", () => {
    const address = { productCode: "p", refNum: 1 };
    const video = (extra: Record<string, unknown>) => ({
      ...address,
      assets: {
        "en-US": [{ key: "intro-video", type: "video", description: "Sky", usages: [], ...extra }],
      },
    });
    const kept = validateManifest(video({ timeline: timeline() }), address);
    expect(kept.assets["en-US"]![0]!.timeline).toEqual(timeline());
    expect(wafManifest(kept).assets["en-US"]![0]).not.toHaveProperty("timeline");
    expect(() => validateManifest(video({ type: "image", timeline: timeline() }), address)).toThrow(
      "Only a video or animation has a timeline.",
    );
    expect(() => validateManifest(video({ timeline: { version: 1 } }), address)).toThrow(
      "Invalid video timeline",
    );
  });
});
