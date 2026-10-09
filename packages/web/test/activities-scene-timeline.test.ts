import { describe, expect, it } from "vitest";
import type { AssetManifest, VideoTimeline } from "@prismshadow/penguin-server/api";
import {
  blocksRender,
  effectChoices,
  fromSeconds,
  issueText,
  musicChoices,
  narrationChoices,
  timelineLength,
  timelineUrl,
  toSeconds,
  withCut,
} from "../src/features/activities/scene-timeline";

type Asset = AssetManifest["assets"][string][number];

const source = { runId: `run_${"a".repeat(32)}`, sha256: "b".repeat(64), format: "mp4" as const };

function timeline(overrides: Partial<VideoTimeline> = {}): VideoTimeline {
  return {
    version: 1,
    width: 640,
    height: 480,
    fps: 30,
    cuts: [
      { id: "a", source, inMs: 0, outMs: 3000, transition: "cut", transitionMs: 0 },
      { id: "b", source, inMs: 0, outMs: 2000, transition: "fade", transitionMs: 500 },
    ],
    narration: [{ asset: "line-1", startMs: 500 }],
    music: null,
    effects: [],
    captions: { enabled: true, maxWords: 8, maxChars: 42 },
    ...overrides,
  };
}

const audio = (key: string, extra: Partial<Asset> = {}): Asset => ({
  key,
  type: "audio",
  description: key,
  usages: [],
  ...extra,
});

describe("scene timeline helpers", () => {
  it("reads and writes seconds as the fields show them", () => {
    expect(toSeconds(1500)).toBe("1.5");
    expect(toSeconds(0)).toBe("0");
    expect(toSeconds(1234)).toBe("1.23");
    expect(fromSeconds(" 2.25 ")).toBe(2250);
    expect(fromSeconds("0")).toBe(0);
    for (const bad of ["", "-1", "1,5", "abc", "1."]) expect(fromSeconds(bad)).toBeNull();
  });

  it("reckons a timeline's length with its fades overlapping, as the server does", () => {
    expect(timelineLength(timeline())).toBe(4500);
  });

  it("offers what can be added: narration not placed yet, music, and effects", () => {
    const group = [
      audio("line-1", { script: "One." }),
      audio("line-2", { script: "Two." }),
      audio("tune", { kind: "music" }),
      audio("chirp", { kind: "sfx" }),
      audio("cat", { role: "bookWord" }),
      { key: "video", type: "video", description: "v", usages: [] } as Asset,
    ];
    expect(narrationChoices(group, timeline()).map((asset) => asset.key)).toEqual(["line-2"]);
    expect(musicChoices(group).map((asset) => asset.key)).toEqual(["tune"]);
    expect(effectChoices(group).map((asset) => asset.key)).toEqual(["chirp"]);
  });

  it("keeps a changed cut valid", () => {
    // The first cut never fades in.
    expect(withCut(timeline(), 0, { transition: "fade", transitionMs: 500 }).cuts[0]).toMatchObject(
      { transition: "cut", transitionMs: 0 },
    );
    // A plain cut takes no time; a new fade takes a second.
    const plain = withCut(timeline(), 1, { transition: "cut" });
    expect(plain.cuts[1]).toMatchObject({ transition: "cut", transitionMs: 0 });
    expect(withCut(plain, 1, { transition: "fadeblack" }).cuts[1]).toMatchObject({
      transition: "fadeblack",
      transitionMs: 1000,
    });
    expect(withCut(timeline(), 1, { outMs: 2500 }).cuts[1]!.outMs).toBe(2500);
  });

  it("words the server's issues, and knows which stop a render", () => {
    expect(issueText({ code: "asset_unbound", asset: "line-2" })).toBe(
      "line-2 has no clip yet. Generate or upload it first.",
    );
    expect(blocksRender({ code: "asset_missing", asset: "x" })).toBe(true);
    expect(blocksRender({ code: "past_end", asset: "x" })).toBe(false);
    expect(timelineUrl("/api/x", "en-US", "intro video")).toBe(
      "/api/x/video-timeline?language=en-US&assetKey=intro%20video",
    );
  });
});
