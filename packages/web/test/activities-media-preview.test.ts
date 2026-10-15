import { describe, expect, it } from "vitest";
import type { AssetManifest } from "@prismshadow/penguin-server/api";
import { mediaPreview } from "../src/features/activities/media-preview";
import { narrationScenes } from "../src/features/activities/narration-scenes";
import { boundSource } from "../src/features/activities/ref-plan";
import { buildSceneTree } from "../src/features/activities/scene-assets";
import { sceneRanges } from "../src/features/activities/script-model";

type MediaAsset = AssetManifest["assets"][string][number];

const endpoint = "/api/projects/p/activities/act";
const blank = "media/loom/words/words-1/videos/english/empty.mp4";

const usage = (sceneId: string, key: string) => ({
  sceneId,
  sourceKey: key,
  occurrence: 1,
  sceneOccurrenceCount: 1,
});

const asset = (key: string, type: MediaAsset["type"], extra: Partial<MediaAsset> = {}) =>
  ({ key, type, description: key, usages: [], ...extra }) as MediaAsset;

describe("media previews", () => {
  it("shows a picture from wherever its file is served, and a video from its first frame", () => {
    expect(
      mediaPreview(asset("cat", "image", { path: "media/images/cat.png" }), endpoint, new Set()),
    ).toEqual({ kind: "image", src: `${endpoint}/sandbox/media/images/cat.png` });
    expect(
      mediaPreview(
        asset("map", "image", {
          path: "media/loom/words/words-1/images/english/map.png",
          generatedImage: { runId: "run_1", sha256: "a" },
        }),
        endpoint,
        new Set(),
      ),
    ).toEqual({ kind: "image", src: `${endpoint}/runs/run_1/image` });
    expect(
      mediaPreview(asset("sea", "video", { path: "media/videos/sea.mp4" }), endpoint, new Set()),
    ).toEqual({ kind: "video", src: `${endpoint}/sandbox/media/videos/sea.mp4#t=0.1` });
  });

  it("names a placeholder without loading it, and has nothing to show for sound or no file", () => {
    expect(
      mediaPreview(asset("chest", "video", { path: blank }), endpoint, new Set([blank])),
    ).toEqual({ kind: "placeholder" });
    expect(mediaPreview(asset("chest", "video"), endpoint, new Set([blank]))).toEqual({
      kind: "none",
    });
    expect(
      mediaPreview(asset("hello", "audio", { path: "media/audio/hello.wav" }), endpoint, new Set()),
    ).toEqual({ kind: "none" });
    expect(mediaPreview(undefined, endpoint, new Set())).toEqual({ kind: "none" });
  });

  it("serves a generated picture from its run, like a generated clip", () => {
    expect(
      boundSource(
        asset("map", "image", {
          path: "media/x.png",
          generatedImage: { runId: "run_2", sha256: "b" },
        }),
        endpoint,
      ),
    ).toBe(`${endpoint}/runs/run_2/image`);
  });
});

describe("narration by scene", () => {
  const spec = {
    scenes: [
      { id: "general", description: "Shared lines." },
      { id: "scene-1", description: "Hello." },
      { id: "scene-2", description: "Rocks." },
    ],
  };
  const lines = [
    asset("praise", "audio", { script: "Well done!", usages: [usage("general", "praise")] }),
    asset("find_d", "audio", { script: "Find d.", usages: [usage("scene-2", "find_d")] }),
    asset("welcome", "audio", { script: "Welcome!", usages: [usage("scene-1", "welcome")] }),
    asset("hint", "audio", { script: "Look again.", usages: [usage("scene-2", "hint")] }),
    asset("intro_d", "audio", {
      script: "Here are the stones.",
      usages: [usage("scene-2", "intro_d")],
    }),
    asset("again", "audio", {
      script: "Try again.",
      usages: [usage("scene-2", "again"), usage("scene-1", "again")],
    }),
    asset("lost", "audio", { script: "Gone.", usages: [usage("scene-9", "lost")] }),
  ];
  const script = [
    "Scene 1: Hello",
    "<audio>Welcome!</audio>",
    "Scene 2: Rocks",
    "<audio>Here are the stones.</audio>",
    "Then <audio>find d.</audio>",
  ].join("\n");
  const rows = lines.map((line) => ({
    key: line.key,
    sceneIds: line.usages.map((entry) => entry.sceneId),
  }));

  it("groups lines under their scenes, in the script's order, the lost ones last", () => {
    const groups = narrationScenes(
      rows,
      buildSceneTree(spec, lines),
      { text: script, scenes: sceneRanges(script) },
      (key) => lines.find((line) => line.key === key)?.script,
    );
    expect(
      groups.map((group) => [
        group.sceneId,
        group.title,
        group.number,
        group.general,
        group.rows.map((row) => row.key),
      ]),
    ).toEqual([
      ["general", null, null, true, ["praise"]],
      // A line two scenes say is listed once, under the first of them.
      ["scene-1", "Hello", 1, false, ["welcome", "again"]],
      // Lines the script says come in its order; the rest keep the plan's order after them.
      ["scene-2", "Rocks", 2, false, ["intro_d", "find_d", "hint"]],
      ["", null, null, false, ["lost"]],
    ]);
  });

  it("drops a scene the filters leave without lines", () => {
    const groups = narrationScenes(
      rows.filter((row) => row.key === "hint"),
      buildSceneTree(spec, lines),
      { text: script, scenes: sceneRanges(script) },
      () => undefined,
    );
    expect(groups.map((group) => group.sceneId)).toEqual(["scene-2"]);
  });
});
