import { describe, expect, it } from "vitest";
import type { AssetManifest } from "@prismshadow/penguin-server/api";
import type { PlayerReport } from "../src/features/activities/player-bridge";
import {
  IDLE_CLOCK,
  TIMELINE_MIN_SECONDS,
  clockAfterMedia,
  clockAfterReport,
  neighbourScene,
  playScenes,
  playView,
  sceneOfLine,
  tapNow,
  timelineWeights,
  type PlayClock,
  type PlayScene,
} from "../src/features/activities/play-model";
import { buildSceneTree } from "../src/features/activities/scene-assets";
import { sceneRanges } from "../src/features/activities/script-model";

type MediaAsset = AssetManifest["assets"][string][number];

const usage = (sceneId: string, key: string) => ({
  sceneId,
  sourceKey: key,
  occurrence: 1,
  sceneOccurrenceCount: 1,
});

const audio = (key: string, script: string, scenes: string[], extra: Partial<MediaAsset> = {}) =>
  ({
    key,
    type: "audio",
    description: "",
    script,
    usages: scenes.map((scene) => usage(scene, key)),
    ...extra,
  }) as MediaAsset;

const spec = {
  scenes: [{ id: "general" }, { id: "scene-1" }, { id: "scene-2" }, { id: "scene-3" }],
};
const assets: MediaAsset[] = [
  audio("praise", "Well done!", ["general"]),
  audio("hunt", "We are going on a treasure hunt.", ["scene-1"], {
    path: "media/a/hunt.wav",
    durationMs: 1907,
    wordTimings: [
      { word: "We", startMs: 0, endMs: 80 },
      { word: "are", startMs: 80, endMs: 300 },
      { word: "going", startMs: 300, endMs: 700 },
    ],
  }),
  audio("letters", "Each treasure is a letter.", ["scene-1", "scene-2"], {
    wordTimings: [{ word: "Each", startMs: 0, endMs: 2400 }],
  }),
  // No clip yet: its length is a guess from its five words.
  audio("find", "Press and hold lowercase d.", ["scene-2"]),
  // Music is not a line anyone says.
  audio("theme", "", ["scene-1"], { kind: "music" } as Partial<MediaAsset>),
];
const script = [
  "Scene 1: Getting started",
  "The narrator says <audio>We are going on a treasure hunt.</audio>",
  "Then <audio>Each treasure is a letter.</audio>",
  "Scene 2: Letter d",
  "<audio>Press and hold lowercase d.</audio>",
  "Scene 3: Treasure",
  "A video plays.",
].join("\n");

const scenes: PlayScene[] = playScenes({
  tree: buildSceneTree(spec, assets),
  script: { text: script, scenes: sceneRanges(script) },
  assets,
  sourceOf: (asset) => (asset.path ? `/files/${asset.key}` : null),
  previewOf: (sceneId) => (sceneId === "scene-3" ? { kind: "placeholder" } : { kind: "none" }),
});

const report = (sceneId: string, interactables: PlayerReport["interactables"] = []) =>
  ({
    state: { index: 1, phase: "presenting", sceneId, state: `${sceneId}.presenting` },
    interactables,
  }) as PlayerReport;

describe("playScenes", () => {
  it("walks the scenes in order, each with its narration in the script's order", () => {
    expect(
      scenes.map((scene) => [
        scene.sceneId,
        scene.number,
        scene.title,
        scene.lines.map((l) => l.key),
      ]),
    ).toEqual([
      // Shared media is no step of the activity; music is no line.
      ["scene-1", 1, "Getting started", ["hunt", "letters"]],
      // A line two scenes say is listed under both, so it lights up in either; this script
      // says it only in the first, so in the second it follows the lines said there.
      ["scene-2", 2, "Letter d", ["find", "letters"]],
      ["scene-3", 3, "Treasure", []],
    ]);
    expect(scenes[2]!.preview).toEqual({ kind: "placeholder" });
  });

  it("times a line by its clip, then its timings, then its words", () => {
    const [hunt, letters] = scenes[0]!.lines;
    expect(hunt).toMatchObject({ durationMs: 1907, estimated: false, src: "/files/hunt" });
    expect(letters).toMatchObject({ durationMs: 2400, estimated: false, src: null });
    // Five words at 130 a minute.
    expect(scenes[1]!.lines[0]).toMatchObject({ durationMs: 2308, estimated: true });
    expect(scenes[0]!.durationMs).toBe(1907 + 2400);
  });
});

describe("the play clock", () => {
  it("starts a scene's time when the activity enters it, and keeps it within the scene", () => {
    const entered = clockAfterReport(IDLE_CLOCK, report("scene-1"), 100);
    expect(entered.scene).toEqual({ id: "scene-1", at: 100 });
    expect(clockAfterReport(entered, report("scene-1"), 900)).toBe(entered);
    expect(clockAfterReport(entered, report("scene-2"), 900).scene).toEqual({
      id: "scene-2",
      at: 900,
    });
  });

  it("follows the clip sounding now from the clips the activity starts and ends", () => {
    const started = clockAfterMedia(
      IDLE_CLOCK,
      { index: 1, kind: "audio", key: "hunt", status: "started" },
      200,
    );
    expect(started).toMatchObject({ audio: { key: "hunt", at: 200 }, heard: true });
    // Another clip ending leaves this one sounding.
    const other = clockAfterMedia(
      started,
      { index: 2, kind: "audio", key: "letters", status: "completed" },
      300,
    );
    expect(other.audio).toEqual({ key: "hunt", at: 200 });
    for (const status of ["completed", "interrupted", "failed"])
      expect(
        clockAfterMedia(started, { index: 3, kind: "audio", key: "hunt", status }, 400).audio,
      ).toBeNull();
    const video = clockAfterMedia(
      started,
      { index: 4, kind: "video", key: "chest", status: "started" },
      500,
    );
    expect(video).toMatchObject({ audio: { key: "hunt" }, video: { key: "chest", at: 500 } });
    // A kind the model does not follow still says the module reports its media.
    expect(
      clockAfterMedia(IDLE_CLOCK, { index: 1, kind: "lottie", key: "x", status: "started" }, 1),
    ).toEqual({ ...IDLE_CLOCK, heard: true });
  });
});

describe("playView: the line lit", () => {
  const playing: PlayClock = {
    scene: { id: "scene-1", at: 0 },
    audio: { key: "hunt", at: 1000 },
    video: null,
    heard: true,
  };

  it("lights the line the player is saying, its word and how far through it is", () => {
    const view = playView(scenes, playing, null, 1000 + 350);
    expect(view).toEqual({
      sceneId: "scene-1",
      playingSceneId: "scene-1",
      lit: { key: "hunt", sceneId: "scene-1", by: "player", word: 2, progress: 350 / 1907 },
    });
    // Past the last timed word, no word is lit but the line still is.
    expect(playView(scenes, playing, null, 1000 + 1500).lit).toMatchObject({ word: -1 });
    expect(playView(scenes, playing, null, 1000 + 9000).lit?.progress).toBe(1);
  });

  it("prefers the playing scene for a line several scenes say", () => {
    const clock = {
      ...playing,
      scene: { id: "scene-2", at: 0 },
      audio: { key: "letters", at: 10 },
    };
    expect(playView(scenes, clock, null, 20).lit?.sceneId).toBe("scene-2");
  });

  it("shows the playing scene with nothing lit between lines", () => {
    const view = playView(scenes, { ...playing, audio: null }, null, 5000);
    expect(view).toEqual({ sceneId: "scene-1", playingSceneId: "scene-1", lit: null });
    // A sound that is no line lights nothing either.
    expect(
      playView(scenes, { ...playing, audio: { key: "theme", at: 1 } }, null, 2).lit,
    ).toBeNull();
  });

  it("lights a line an author chose until the player says another", () => {
    const chosen = playView(scenes, playing, { key: "find", at: 2000 }, 2100);
    expect(chosen).toEqual({
      sceneId: "scene-2",
      playingSceneId: "scene-1",
      lit: { key: "find", sceneId: "scene-2", by: "author", word: -1, progress: 0 },
    });
    const later = { ...playing, audio: { key: "letters", at: 3000 } };
    expect(playView(scenes, later, { key: "find", at: 2000 }, 3100).lit).toMatchObject({
      key: "letters",
      by: "player",
    });
  });

  it("lets a choice go once the activity moves on to another scene", () => {
    const moved = { ...playing, scene: { id: "scene-3", at: 4000 }, audio: null };
    expect(playView(scenes, moved, { key: "find", at: 2000 }, 4100)).toEqual({
      sceneId: "scene-3",
      playingSceneId: "scene-3",
      lit: null,
    });
  });

  it("shows the first scene before the activity reports one, and finds a line's scene", () => {
    expect(playView(scenes, IDLE_CLOCK, null, 0)).toEqual({
      sceneId: "scene-1",
      playingSceneId: null,
      lit: null,
    });
    // A scene the player does not walk (shared media) is not one to show.
    const shared = { ...IDLE_CLOCK, scene: { id: "general", at: 0 } };
    expect(playView(scenes, shared, null, 0).playingSceneId).toBeNull();
    expect(sceneOfLine(scenes, "find")).toBe("scene-2");
    expect(sceneOfLine(scenes, "praise")).toBeNull();
  });
});

describe("tapNow", () => {
  it("waits until the activity says where it is", () => {
    expect(tapNow(null, IDLE_CLOCK)).toEqual({ kind: "waiting" });
  });

  it("says why nothing can be tapped when the media says", () => {
    const speaking = { ...IDLE_CLOCK, audio: { key: "hunt", at: 0 } };
    const video = { ...IDLE_CLOCK, video: { key: "chest", at: 0 } };
    expect(tapNow(report("scene-1"), speaking)).toEqual({ kind: "none", because: "speaking" });
    expect(tapNow(report("scene-1"), video)).toEqual({ kind: "none", because: "video" });
    expect(tapNow(report("scene-1"), IDLE_CLOCK)).toEqual({ kind: "none", because: "nothing" });
  });

  it("names the targets by what they are, grouped by what a learner does", () => {
    const targets = report("scene-2", [
      { id: "rock-a", inputType: "CLICK", description: "First rock" },
      { id: "rock-b", inputType: "DRAG" },
      { id: "rock-c", inputType: "CLICK" },
      { id: "rock-d", inputType: "CLICK" },
      { id: "rock-e", inputType: "SELECT" },
    ]);
    expect(tapNow(targets, IDLE_CLOCK)).toEqual({
      kind: "targets",
      groups: [
        { inputType: "CLICK", names: ["First rock", "rock-c"], ids: ["rock-a", "rock-c"] },
        { inputType: "DRAG", names: ["rock-b"], ids: ["rock-b"] },
      ],
      more: 2,
    });
  });
});

describe("the scene timeline", () => {
  it("sizes each scene by its narration, never under the minimum", () => {
    expect(timelineWeights(scenes)).toEqual([4.307, 4.708, TIMELINE_MIN_SECONDS]);
  });

  it("steps to the scene before or after, holding at the ends", () => {
    expect(neighbourScene(scenes, "scene-2", 1)).toBe("scene-3");
    expect(neighbourScene(scenes, "scene-2", -1)).toBe("scene-1");
    expect(neighbourScene(scenes, "scene-3", 1)).toBeNull();
    expect(neighbourScene(scenes, "scene-1", -1)).toBeNull();
    // Before any scene is known, forward starts at the first.
    expect(neighbourScene(scenes, null, 1)).toBe("scene-1");
  });
});
