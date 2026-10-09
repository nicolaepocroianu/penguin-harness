import { describe, expect, it } from "vitest";
import type { AssetManifest } from "@prismshadow/penguin-server/api";
import {
  buildScriptMedia,
  elementText,
  formatClipLength,
  normalizeWords,
  scriptFigures,
} from "../src/features/activities/script-media";
import { sceneRanges } from "../src/features/activities/script-model";
import { buildSceneTree } from "../src/features/activities/scene-assets";
import { progressSteps } from "../src/features/activities/studio-status";

type MediaAsset = AssetManifest["assets"][string][number];

const asset = (fields: Partial<MediaAsset> & Pick<MediaAsset, "key" | "type">): MediaAsset =>
  ({ description: "", usages: [], ...fields }) as MediaAsset;

const script = [
  "An activity about letters.",
  "Scene 1: Intro",
  "<video>A colorful island with a treasure map.</video>",
  "Scene 2: Getting Started",
  "The narrator says <audio>We are going on a treasure hunt!</audio>",
  "The narrator says <audio>Each treasure is a letter.</audio>",
].join("\n");

const assets = [
  asset({
    key: "s1_island",
    type: "video",
    description: "A colorful island with a treasure map",
    path: "media/island.mp4",
    usages: [{ sceneId: "scene-1" }],
  } as Partial<MediaAsset> & Pick<MediaAsset, "key" | "type">),
  asset({
    key: "s2_hunt",
    type: "audio",
    description: "",
    script: "We are going on a treasure hunt.",
    path: "media/hunt.wav",
    durationMs: 1800,
    usages: [{ sceneId: "scene-2" }],
  } as Partial<MediaAsset> & Pick<MediaAsset, "key" | "type">),
  asset({
    key: "s2_letter",
    type: "audio",
    description: "",
    script: "Each treasure is a letter",
    usages: [{ sceneId: "scene-2" }],
  } as Partial<MediaAsset> & Pick<MediaAsset, "key" | "type">),
];

const spec = {
  scenes: [
    { id: "scene-1", media: { video: ["s1_island"] } },
    { id: "scene-2", media: { audio: ["s2_hunt", "s2_letter"] } },
  ],
};

describe("tying script lines to clips", () => {
  const media = buildScriptMedia(assets, buildSceneTree(spec, assets), sceneRanges(script));

  it("matches on the words alone, ignoring case, punctuation and spacing", () => {
    expect(normalizeWords("  We are GOING on a treasure-hunt! ")).toBe(
      "we are going on a treasure hunt",
    );
    expect(media.clipFor("audio", "We are going on a treasure hunt!")).toEqual({
      key: "s2_hunt",
      bound: true,
      durationMs: 1800,
    });
    expect(media.clipFor("video", "A colorful island with a treasure map.")?.key).toBe("s1_island");
  });

  it("says a clip has no file yet, and says nothing for a line no clip has", () => {
    expect(media.clipFor("audio", "Each treasure is a letter.")).toEqual({
      key: "s2_letter",
      bound: false,
    });
    expect(media.clipFor("audio", "Something the plan never heard")).toBeNull();
    // An audio line never matches a picture's description, or the other way round.
    expect(media.clipFor("audio", "A colorful island with a treasure map")).toBeNull();
  });

  it("counts every clip and how many have files", () => {
    expect(media.totals).toEqual({ bound: 2, total: 3 });
  });

  it("reads the words between an element's tags", () => {
    expect(elementText("<audio voice='x'>Hello there</audio>")).toBe("Hello there");
  });
});

describe("script figures", () => {
  it("counts words without tags, and narration from audio elements only", () => {
    const figures = scriptFigures(script);
    expect(figures.words).toBe(36);
    // 12 spoken words at 130 a minute.
    expect(figures.narrationSeconds).toBe(6);
  });

  it("gives clip lengths in seconds, then minutes", () => {
    expect(formatClipLength(1800)).toBe("1.8 s");
    expect(formatClipLength(65_000)).toBe("1 min 05 s");
  });
});

describe("the header's progress steps", () => {
  const facts = {
    status: "valid" as const,
    scriptDirty: false,
    specDirty: false,
    media: { bound: 21, total: 27 },
    hasModule: false,
  };

  it("says where each step stands, in a tone by meaning", () => {
    expect(progressSteps(facts).map(({ label, state, tone }) => [label, state, tone])).toEqual([
      ["Script", "saved", "success"],
      ["Spec", "Validated", "success"],
      ["Media", "21/27", "attention"],
      ["Module", "not built", "muted"],
    ]);
  });

  it("puts unsaved edits first, and waits on a plan before counting media", () => {
    const steps = progressSteps({ ...facts, scriptDirty: true, specDirty: true, media: null });
    expect(steps[0]).toMatchObject({ state: "unsaved", tone: "attention" });
    expect(steps[1]).toMatchObject({ state: "unsaved", tone: "attention" });
    expect(steps[2]).toMatchObject({ state: "no plan yet", tone: "muted" });
  });
});
