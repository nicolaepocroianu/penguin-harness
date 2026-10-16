import { describe, expect, it } from "vitest";
import { posterOf, summarize, type SummaryFacts } from "../src/activities/activity-summary.js";
import type { MediaAsset } from "../src/activities/media.js";

const fresh: SummaryFacts = {
  canonical: true,
  specValid: false,
  plan: "none",
  hasModule: false,
  runningKind: null,
};

describe("summarize", () => {
  it("names the first missing milestone as next", () => {
    expect(summarize(fresh)).toEqual({
      canonical: true,
      hasPlan: false,
      done: 0,
      total: 3,
      status: { kind: "next", milestone: "spec" },
      poster: null,
    });
    expect(summarize({ ...fresh, specValid: true }).status).toEqual({
      kind: "next",
      milestone: "mediaPlan",
    });
    expect(summarize({ ...fresh, specValid: true, plan: "current" }).status).toEqual({
      kind: "next",
      milestone: "module",
    });
  });

  it("counts a stale plan as not done and reports it", () => {
    const summary = summarize({ ...fresh, specValid: true, plan: "stale", hasModule: true });
    expect(summary.done).toBe(2);
    expect(summary.hasPlan).toBe(true);
    expect(summary.status).toEqual({ kind: "stale", what: "mediaPlan" });
  });

  it("is built when every milestone is reached", () => {
    const summary = summarize({ ...fresh, specValid: true, plan: "current", hasModule: true });
    expect(summary).toMatchObject({ done: 3, status: { kind: "built" } });
  });

  it("puts a running run above everything else", () => {
    const summary = summarize({
      ...fresh,
      specValid: true,
      plan: "stale",
      hasModule: true,
      runningKind: "audio",
    });
    expect(summary.status).toEqual({ kind: "running", runKind: "audio" });
  });

  it("counts an imported module without a plan as built only once the plan exists", () => {
    // A Loom import can play from the checkout before Penguin planned its media.
    const summary = summarize({ ...fresh, specValid: true, hasModule: true });
    expect(summary).toMatchObject({ done: 2, status: { kind: "next", milestone: "mediaPlan" } });
  });

  it("passes canonical through", () => {
    expect(summarize({ ...fresh, canonical: false }).canonical).toBe(false);
  });
});

describe("posterOf", () => {
  const asset = (
    key: string,
    type: MediaAsset["type"],
    sceneId: string,
    path?: string,
  ): MediaAsset => ({
    key,
    type,
    description: key,
    ...(path ? { path } : {}),
    usages: [{ sceneId, sourceKey: key, occurrence: 1, sceneOccurrenceCount: 1 }],
  });
  const spec = { scenes: [{ id: "scene-1" }, { id: "scene-2" }] };
  const stand = "media/loom/p/p-1/en-US/videos/empty.mp4";

  it("takes the first picture or video with a real file, in the specification's scene order", () => {
    const assets = {
      "en-US": [
        asset("scene-2-video-chest", "video", "scene-2", "media/v/chest.mp4"),
        asset("scene-1-audio-hello", "audio", "scene-1", "media/a/hello.wav"),
        asset("scene-1-image-map", "image", "scene-1"),
        asset("scene-1-video-island", "video", "scene-1", stand),
      ],
    };
    expect(posterOf(assets, spec, new Set([stand]))).toEqual({
      language: "en-US",
      asset: { key: "scene-2-video-chest", type: "video", path: "media/v/chest.mp4" },
    });
  });

  it("passes over the stand-in clip, and has none when nothing else has a file", () => {
    const assets = { "en-US": [asset("scene-1-video-island", "video", "scene-1", stand)] };
    expect(posterOf(assets, spec, new Set([stand]))).toBeNull();
    expect(posterOf(undefined, spec, new Set())).toBeNull();
    expect(posterOf({}, spec, new Set())).toBeNull();
  });

  it("reads American English first, and keeps how a generated picture is found", () => {
    const generated = {
      ...asset("scene-1-image-map", "image", "scene-1", "media/i/map.png"),
      generatedImage: { runId: "run_1", sha256: "abc" },
    };
    const poster = posterOf(
      {
        "es-MX": [asset("scene-1-image-mapa", "image", "scene-1", "media/i/mapa.png")],
        "en-US": [generated],
      },
      { stages: [{ id: "scene-1" }] },
      new Set(),
    );
    expect(poster).toEqual({
      language: "en-US",
      asset: {
        key: "scene-1-image-map",
        type: "image",
        path: "media/i/map.png",
        generatedImage: { runId: "run_1", sha256: "abc" },
      },
    });
  });
});
