import { describe, expect, it } from "vitest";
import { sceneRanges } from "../src/features/activities/script-model";
import {
  checkNarration,
  mediaBound,
  readSpec,
  sceneAgrees,
  scriptSceneByNumber,
  scriptNarration,
  stripDescriptionPrefix,
  takeScriptLine,
} from "../src/features/activities/spec-scenes";

const script = [
  "An activity about letters.",
  "",
  "Scene 1: Intro",
  "<video>A colorful island with a treasure map.</video>",
  "",
  "Scene 2: Getting Started",
  "The narrator says <audio>We are going on a treasure hunt.</audio>",
  "Then <audio>Every chest hides a letter. Let's find them!</audio>",
  "And <audio>Press and hold the right letter.</audio>",
  "",
  "Scene 3: Letter d",
  "<audio>Find the letter d.</audio>",
  "<audio>Find the letter d.</audio>",
].join("\n");

const spec = {
  id: "letters",
  title: "Letters",
  activityDescription: "usesAssessment=true\nAn activity that helps students identify letters.",
  runtime: {
    engine: "html",
    layout: "mainOnly",
    theme: "park",
    resolution: "640x480",
    usesAssessment: true,
  },
  acceptance_criterias: ["Every letter is found."],
  scenes: [
    {
      id: "scene-1",
      description: "The island appears.\nA map unrolls.",
      media: { video: [{ key: "s1_island", description: "A colorful island" }] },
    },
    {
      id: "scene-2",
      description: "The hunt begins.",
      media: {
        video: [
          { key: "s2_closing", description: "The chest closes." },
          { key: "s2_opening", description: "The chest opens." },
        ],
        images: [{ key: "s2_map", description: "The map" }],
      },
      audio: {
        tracks: [
          { key: "s2_hunt", description: "", script: "We are going on a treasure hunt." },
          { key: "s2_chest", description: "", script: "Each treasure chest hides a letter." },
          { key: "s2_press", description: "", script: "press and hold the right letter" },
          { key: "s2_music", description: "Island music", script: null },
        ],
      },
    },
    {
      id: "scene-3",
      description: "",
      audio: {
        tracks: [
          { key: "s3_find", description: "", script: "Find the letter d." },
          { key: "s3_again", description: "", script: "Find the letter d." },
        ],
      },
    },
    { id: "bonus", description: "A scene the script does not number." },
  ],
};

const text = JSON.stringify(spec, null, 2);
const scenes = sceneRanges(script);

describe("readSpec", () => {
  it("reads the runtime, the description behind its prefix, the criteria and the scenes", () => {
    const reading = readSpec(text, scenes)!;
    expect(reading.runtime).toEqual({
      engine: "html",
      layout: "mainOnly",
      theme: "park",
      resolution: "640x480",
      usesAssessment: true,
    });
    expect(reading.descriptionPrefix).toBe("usesAssessment=true");
    expect(reading.description).toBe("An activity that helps students identify letters.");
    expect(reading.criteria).toEqual(["Every letter is found."]);
    expect(reading.scenes.map((scene) => [scene.number, scene.title])).toEqual([
      [1, "Intro"],
      [2, "Getting Started"],
      [3, "Letter d"],
      [4, "A scene the script does not number."],
    ]);
  });

  it("splits a scene into narration lines and media items, a silent track among the media", () => {
    const scene = readSpec(text, scenes)!.scenes[1]!;
    expect(scene.narration.map((line) => line.key)).toEqual(["s2_hunt", "s2_chest", "s2_press"]);
    expect(scene.media.map((item) => [item.kind, item.key])).toEqual([
      ["image", "s2_map"],
      ["video", "s2_closing"],
      ["video", "s2_opening"],
      ["sound", "s2_music"],
    ]);
  });

  it("names a scene by its description's first line when the script does not, else its id", () => {
    const reading = readSpec(text, [])!;
    expect(reading.scenes[0]!.title).toBe("The island appears.");
    expect(reading.scenes[2]!.title).toBe("scene-3");
  });

  it("reads nothing from text that is not a JSON object", () => {
    expect(readSpec("{ not json", scenes)).toBeNull();
    expect(readSpec("[]", scenes)).toBeNull();
    expect(readSpec("", scenes)).toBeNull();
  });

  it("leaves a description without the prefix alone", () => {
    const reading = readSpec(JSON.stringify({ activityDescription: "Plain." }), scenes)!;
    expect(reading.descriptionPrefix).toBeNull();
    expect(reading.description).toBe("Plain.");
    expect(reading.runtime).toBeNull();
    expect(reading.scenes).toEqual([]);
  });
});

describe("checkNarration", () => {
  const reading = readSpec(text, scenes)!;

  it("reads the script's audio lines under a scene", () => {
    expect(scriptNarration(script, scenes[1]!)).toEqual([
      "We are going on a treasure hunt.",
      "Every chest hides a letter. Let's find them!",
      "Press and hold the right letter.",
    ]);
  });

  it("matches lines by their words and pairs a differing line with the script's spare one", () => {
    const check = checkNarration(reading.scenes[1]!, script, scenes);
    expect(check.known).toBe(true);
    expect(check.lines.map((line) => line.matches)).toEqual([true, false, true]);
    expect(check.lines[1]!.scriptSays).toBe("Every chest hides a letter. Let's find them!");
    expect(check.differing).toBe(1);
    expect(check.extraInScript).toBe(0);
    expect(sceneAgrees(check)).toBe(false);
  });

  it("agrees on a scene whose lines all match, counting a repeated line once per copy", () => {
    const check = checkNarration(reading.scenes[2]!, script, scenes);
    expect(check.lines.map((line) => line.matches)).toEqual([true, true]);
    expect(sceneAgrees(check)).toBe(true);
  });

  it("agrees on a scene with no narration on either side", () => {
    expect(sceneAgrees(checkNarration(reading.scenes[0]!, script, scenes))).toBe(true);
  });

  it("does not compare a scene the script does not number", () => {
    const check = checkNarration(reading.scenes[3]!, script, scenes);
    expect(check.known).toBe(false);
    expect(sceneAgrees(check)).toBe(false);
  });

  it("counts the script's extra lines, and leaves a spec line without a pair unpaired", () => {
    const fewer = readSpec(
      JSON.stringify({
        scenes: [
          { id: "scene-2", description: "", audio: { tracks: [{ key: "a", script: "Hello." }] } },
        ],
      }),
      scenes,
    )!;
    const check = checkNarration(fewer.scenes[0]!, script, scenes);
    expect(check.lines[0]).toMatchObject({
      matches: false,
      scriptSays: "We are going on a treasure hunt.",
    });
    expect(check.differing).toBe(1);
    expect(check.extraInScript).toBe(2);

    const more = readSpec(
      JSON.stringify({
        scenes: [
          {
            id: "scene-3",
            description: "",
            audio: {
              tracks: [
                { key: "a", script: "Find the letter d." },
                { key: "b", script: "Find the letter d." },
                { key: "c", script: "Find the letter e." },
              ],
            },
          },
        ],
      }),
      scenes,
    )!;
    const over = checkNarration(more.scenes[0]!, script, scenes);
    expect(over.lines[2]).toMatchObject({ matches: false, scriptSays: null });
    expect(over.differing).toBe(1);
    expect(over.extraInScript).toBe(0);
  });
});

describe("the fixes", () => {
  it("strips the setting from the description and prints the document as the editor does", () => {
    const next = stripDescriptionPrefix(text)!;
    expect(JSON.parse(next).activityDescription).toBe(
      "An activity that helps students identify letters.",
    );
    expect(next).toBe(
      JSON.stringify(
        { ...spec, activityDescription: "An activity that helps students identify letters." },
        null,
        2,
      ),
    );
    expect(stripDescriptionPrefix(next)).toBeNull();
    expect(stripDescriptionPrefix("{ not json")).toBeNull();
  });

  it("writes the script's line into the named scene's track and nothing else", () => {
    const next = takeScriptLine(text, "scene-2", "s2_chest", "Every chest hides a letter.")!;
    const parsed = JSON.parse(next);
    expect(parsed.scenes[1].audio.tracks[1].script).toBe("Every chest hides a letter.");
    parsed.scenes[1].audio.tracks[1].script = "Each treasure chest hides a letter.";
    expect(parsed).toEqual(spec);
    expect(
      takeScriptLine(text, "scene-2", "s2_chest", spec.scenes[1]!.audio!.tracks[1]!.script!),
    ).toBeNull();
    expect(takeScriptLine(text, "scene-9", "s2_chest", "x")).toBeNull();
    expect(takeScriptLine(text, "scene-2", "missing", "x")).toBeNull();
  });
});

describe("the review fixes", () => {
  it("checks a scene the script numbers but does not name", () => {
    const untitled = sceneRanges("Scene 1:\n<audio>Hello.</audio>");
    const reading = readSpec(
      JSON.stringify({
        scenes: [
          { id: "scene-1", description: "", audio: { tracks: [{ key: "a", script: "Hello." }] } },
        ],
      }),
      untitled,
    )!;
    expect(reading.scenes[0]!.title).toBe("scene-1");
    expect(scriptSceneByNumber("scene-1", untitled)?.number).toBe(1);
    expect(scriptSceneByNumber("bonus", untitled)).toBeUndefined();
    const check = checkNarration(reading.scenes[0]!, "Scene 1:\n<audio>Hello.</audio>", untitled);
    expect(check.known).toBe(true);
    expect(sceneAgrees(check)).toBe(true);
  });

  it("marks a key the plan does not hold as needing a file, and nothing before a plan", () => {
    const bindings = new Map([["cat", true]]);
    expect(mediaBound(bindings, "cat")).toBe(true);
    expect(mediaBound(bindings, "dog")).toBe(false);
    expect(mediaBound(null, "cat")).toBeUndefined();
  });
});
