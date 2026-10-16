import { describe, expect, it } from "vitest";
import type { ActivityRunSummary, AssetManifest } from "@prismshadow/penguin-server/api";
import { indexRuns } from "../src/features/activities/runs-index";
import { buildSceneTree } from "../src/features/activities/scene-assets";
import { sceneRanges } from "../src/features/activities/script-model";
import {
  placeholderAssets,
  sceneBeats,
  storyboardFrames,
} from "../src/features/activities/storyboard";

type MediaAsset = AssetManifest["assets"][string][number];

const usage = (sceneId: string, key: string) => ({
  sceneId,
  sourceKey: key,
  occurrence: 1,
  sceneOccurrenceCount: 1,
});

const spec = {
  scenes: [
    { id: "intro", description: "An island appears." },
    { id: "rocks", description: "Find the letter d." },
    { id: "empty", description: "Nothing yet." },
  ],
};

const assets: MediaAsset[] = [
  { key: "island", type: "image", description: "Island", usages: [usage("intro", "island")] },
  {
    key: "map",
    type: "image",
    description: "Map",
    path: "media/generated/run_1.png",
    generatedImage: { runId: "run_1", sha256: "a" },
    usages: [usage("intro", "map")],
  },
  {
    key: "find_d",
    type: "audio",
    description: "Prompt",
    script: "Find d",
    path: "find_d.mp3",
    usages: [usage("rocks", "find_d")],
  },
  { key: "rock", type: "image", description: "Rock", usages: [usage("rocks", "rock")] },
];

const running = (assetKey: string, language = "en-US") =>
  ({
    runId: "run_x",
    kind: "image",
    status: "running",
    image: { language, assetKey, prompt: "", model: "" },
  }) as unknown as ActivityRunSummary;

describe("storyboard frames", () => {
  it("numbers scenes in order and shows each one's first bound image", () => {
    const frames = storyboardFrames(buildSceneTree(spec, assets), indexRuns([]), [], "en-US");
    expect(
      frames.map((frame) => [
        frame.number,
        frame.sceneId,
        frame.poster?.key ?? null,
        frame.firstAssetKey,
      ]),
    ).toEqual([
      [1, "intro", "map", "island"],
      [2, "rocks", null, "rock"],
      [3, "empty", null, null],
    ]);
    expect(frames[0]).toMatchObject({
      description: "An island appears.",
      assetCount: 2,
      unbound: 1,
      placeholders: 0,
    });
    expect(frames[1]).toMatchObject({ assetCount: 2, unbound: 1 });
  });

  it("marks the scenes an agent is generating for, in the language shown", () => {
    const tree = buildSceneTree(spec, assets);
    expect(
      storyboardFrames(tree, indexRuns([running("rock")]), [], "en-US").map((f) => f.working),
    ).toEqual([false, true, false]);
    expect(
      storyboardFrames(tree, indexRuns([running("rock", "es-MX")]), [], "en-US").some(
        (f) => f.working,
      ),
    ).toBe(false);
  });

  it("marks the scenes an open proposal would change", () => {
    const frames = storyboardFrames(
      buildSceneTree(spec, assets),
      indexRuns([]),
      [
        { target: "media", language: "en-US", assetKey: "island", field: "description", text: "x" },
        { target: "description", text: "whole script" },
      ],
      "en-US",
    );
    expect(frames.map((frame) => frame.proposed)).toEqual([true, false, false]);
  });

  it("titles a scene from the script and reads its beats in the script's order", () => {
    const script = [
      "Intro prose before any scene.",
      "Scene 1: The island",
      "<video>An island with a treasure map</video>",
      "As the video ends, the activity moves on.",
      "Scene 2: Rocks",
      "**Letters on the stones:** d, b, a",
      'The narrator says <audio voice="Kore">Find the letter d.</audio> and waits.',
      "",
      "Activity End",
      "<audio>After the end</audio>",
    ].join("\n");
    const read = { text: script, scenes: sceneRanges(script) };
    // Ids that end in no number name no scene of the script, so the descriptions are read.
    const unnamed = storyboardFrames(
      buildSceneTree(spec, assets),
      indexRuns([]),
      [],
      "en-US",
      read,
    );
    expect(unnamed.map((frame) => frame.title)).toEqual([null, null, null]);
    expect(unnamed[0]!.beats).toEqual([{ kind: "text", text: "An island appears." }]);

    const numbered = {
      scenes: [
        { id: "scene-1", description: "<video>Unused</video>" },
        { id: "scene-2", description: "" },
      ],
    };
    const named = storyboardFrames(buildSceneTree(numbered, []), indexRuns([]), [], "en-US", read);
    expect(named.map((frame) => frame.title)).toEqual(["The island", "Rocks"]);
    expect(named[0]!.beats).toEqual([
      { kind: "video", text: "An island with a treasure map" },
      { kind: "text", text: "As the video ends, the activity moves on." },
    ]);
    expect(named[1]!.beats).toEqual([
      { kind: "text", text: "Letters on the stones: d, b, a" },
      { kind: "text", text: "The narrator says" },
      { kind: "say", text: "Find the letter d." },
      { kind: "text", text: "and waits." },
    ]);
  });

  it("stands a scene's real video before its placeholder, and counts placeholders once", () => {
    const blank = "media/loom/words/words-1/videos/english/empty.mp4";
    const videos: MediaAsset[] = [
      {
        key: "blank",
        type: "video",
        description: "Blank",
        path: blank,
        usages: [usage("intro", "blank")],
      },
      {
        key: "sea",
        type: "video",
        description: "The sea",
        path: "media/loom/words/words-1/videos/english/sea.mp4",
        usages: [usage("intro", "sea")],
      },
      {
        key: "chest",
        type: "video",
        description: "A chest",
        path: blank,
        usages: [usage("rocks", "chest"), usage("intro", "chest")],
      },
    ];
    const tree = buildSceneTree(spec, videos, new Set([blank]));
    const frames = storyboardFrames(tree, indexRuns([]), [], "en-US");
    expect(frames.map((frame) => [frame.poster, frame.placeholders])).toEqual([
      [{ key: "sea", type: "video" }, 2],
      [{ key: "chest", type: "video" }, 1],
      [null, 0],
    ]);
    expect(placeholderAssets(tree)).toEqual([
      { sceneId: "intro", key: "blank" },
      { sceneId: "intro", key: "chest" },
    ]);
  });
});

describe("scene beats", () => {
  it("marks a clip bound only to the placeholder, and keeps a clip with no words", () => {
    const beats = sceneBeats(
      ["<video>A treasure chest</video> then <image></image>", "<image/> stray tag"],
      (element, text) =>
        element === "video" && text === "A treasure chest"
          ? { key: "chest", type: "video" as const, bound: true, placeholder: true }
          : null,
    );
    expect(beats).toEqual([
      { kind: "video", text: "A treasure chest", placeholder: true },
      { kind: "text", text: "then" },
      { kind: "image", text: "" },
      { kind: "text", text: "stray tag" },
    ]);
  });
});
