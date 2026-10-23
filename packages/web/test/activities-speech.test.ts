import { describe, expect, it } from "vitest";
import type { ActivityRunSummary, AssetManifest } from "@waterford/waf-harness-server/api";
import {
  SPEECH_SCRIPT_MAX,
  inSpeechFilter,
  neediestLanguage,
  pendingSpeechKeys,
  speechScriptUsable,
  speechStatuses,
  speechTally,
} from "../src/features/activities/bulk-speech";
import { indexRuns } from "../src/features/activities/runs-index";
import {
  clipTime,
  normalizePeaks,
  remainingLength,
  selectionBetween,
  selectionFromDrag,
  selectionEdgeAt,
  moveSelectionEdge,
  playedFraction,
  seekTime,
  waveformPeaks,
} from "../src/features/activities/waveform";

type MediaAsset = AssetManifest["assets"][string][number];

function asset(over: Partial<MediaAsset> & Pick<MediaAsset, "key">): MediaAsset {
  return {
    type: "audio",
    description: `${over.key} description`,
    usages: [{ sceneId: "intro", sourceKey: over.key, occurrence: 1, sceneOccurrenceCount: 1 }],
    ...over,
  } as MediaAsset;
}

const assets: MediaAsset[] = [
  asset({ key: "bound_generated", script: "Hi", path: "media/generated/run_x.wav" }),
  asset({ key: "bound_upload", script: "Hi", path: "media/uploads/hi-1234abcd.wav" }),
  asset({ key: "needs_speech", script: "Say this" }),
  asset({ key: "also_needs", script: "And this" }),
  asset({ key: "no_script", script: "   " }),
  asset({ key: "script_too_long", script: "a".repeat(SPEECH_SCRIPT_MAX + 1) }),
  asset({ key: "a_picture", type: "image" }),
];

describe("speech readiness", () => {
  it("treats any binding as ready, however the audio got there", () => {
    const states = Object.fromEntries(
      speechStatuses(assets).map((status) => [status.key, status.state]),
    );
    expect(states.bound_generated).toBe("ready");
    expect(states.bound_upload).toBe("ready");
    expect(states.needs_speech).toBe("missing");
  });

  it("separates what cannot be generated from what simply has not been", () => {
    const states = Object.fromEntries(
      speechStatuses(assets).map((status) => [status.key, status.state]),
    );
    expect(states.no_script).toBe("scriptMissing");
    expect(states.script_too_long).toBe("scriptTooLong");
  });

  it("looks only at narration", () => {
    expect(speechStatuses(assets).some((status) => status.key === "a_picture")).toBe(false);
    expect(speechStatuses([])).toEqual([]);
  });

  it("names the scenes asking for a narration, once each", () => {
    const shared = asset({
      key: "shared",
      usages: [
        { sceneId: "intro", sourceKey: "shared", occurrence: 1, sceneOccurrenceCount: 2 },
        { sceneId: "intro", sourceKey: "shared", occurrence: 2, sceneOccurrenceCount: 2 },
        { sceneId: "quiz", sourceKey: "shared", occurrence: 1, sceneOccurrenceCount: 1 },
      ],
    });
    expect(speechStatuses([shared])[0]!.sceneIds).toEqual(["intro", "quiz"]);
  });

  it("agrees with itself about what a bulk run would do", () => {
    expect(pendingSpeechKeys(assets)).toEqual(["needs_speech", "also_needs"]);
    expect(pendingSpeechKeys(assets)).toHaveLength(speechTally(assets).pending);
  });

  it("counts every narration exactly once", () => {
    const tally = speechTally(assets);
    expect(tally).toEqual({ total: 6, ready: 2, pending: 2, failed: 0, generating: 0, blocked: 2 });
    expect(tally.ready + tally.pending + tally.blocked).toBe(tally.total);
    expect(speechTally([])).toEqual({
      total: 0,
      ready: 0,
      pending: 0,
      failed: 0,
      generating: 0,
      blocked: 0,
    });
  });

  it("reads each narration's latest speech run in the language shown", () => {
    const run = (key: string, status: string, createdAt: string, language = "en-US") =>
      ({
        kind: "audio",
        status,
        createdAt,
        error: status === "failed" ? "The voice timed out." : null,
        audio: { language, assetKey: key },
      }) as unknown as ActivityRunSummary;
    const runs = indexRuns([
      run("needs_speech", "failed", "2026-09-23T10:00:00Z"),
      run("needs_speech", "failed", "2026-09-23T09:00:00Z"),
      run("also_needs", "failed", "2026-09-23T09:00:00Z"),
      run("also_needs", "running", "2026-09-23T10:00:00Z"),
      run("bound_upload", "failed", "2026-09-23T11:00:00Z"),
      run("no_script", "failed", "2026-09-23T11:00:00Z", "es-MX"),
    ]);
    const statuses = speechStatuses(assets, runs, "en-US");
    expect(statuses.find((status) => status.key === "needs_speech")).toMatchObject({
      state: "failed",
      error: "The voice timed out.",
    });
    expect(statuses.find((status) => status.key === "also_needs")!.state).toBe("generating");
    // A bound narration is bound, whatever an old run did.
    expect(statuses.find((status) => status.key === "bound_upload")!.state).toBe("ready");
    // Failed ones are tried again by the bulk run; one already generating is not doubled.
    expect(pendingSpeechKeys(assets, runs, "en-US")).toEqual(["needs_speech"]);
    expect(speechTally(assets, runs, "en-US")).toMatchObject({
      failed: 1,
      generating: 1,
      pending: 1,
    });
    const failed = statuses.find((status) => status.key === "needs_speech")!;
    expect(inSpeechFilter(failed, "failed")).toBe(true);
    expect(inSpeechFilter(failed, "needs")).toBe(true);
    expect(inSpeechFilter(failed, "ready")).toBe(false);
    const noScript = statuses.find((status) => status.key === "no_script")!;
    expect(inSpeechFilter(noScript, "blocked")).toBe(true);
    expect(inSpeechFilter(noScript, "needs")).toBe(false);
  });

  it("judges a script by the endpoint's own limit", () => {
    expect(speechScriptUsable(asset({ key: "a", script: "Hello" }))).toBe(true);
    expect(speechScriptUsable(asset({ key: "a", script: " " }))).toBe(false);
    expect(speechScriptUsable(asset({ key: "a" }))).toBe(false);
    expect(speechScriptUsable(asset({ key: "a", script: "a".repeat(SPEECH_SCRIPT_MAX) }))).toBe(
      true,
    );
    expect(speechScriptUsable(asset({ key: "a", script: "a".repeat(SPEECH_SCRIPT_MAX + 1) }))).toBe(
      false,
    );
  });

  it("opens on the language with the most speech still to do", () => {
    const manifest = {
      productCode: "p",
      refNum: 1,
      assets: {
        "en-US": [asset({ key: "a", script: "x", path: "media/a.wav" })],
        "fr-FR": [asset({ key: "a", script: "x" }), asset({ key: "b", script: "y" })],
      },
    } as unknown as AssetManifest;
    expect(neediestLanguage(manifest)).toBe("fr-FR");
    expect(
      neediestLanguage({ productCode: "p", refNum: 1, assets: {} } as unknown as AssetManifest),
    ).toBe("en-US");
  });
});

describe("waveform arithmetic", () => {
  it("keeps the loudest sample in each column, not the average", () => {
    const samples = new Float32Array([0, 0, 0, 0.9, 0, 0, 0, 0.1]);
    const peaks = waveformPeaks(samples, 2);
    // Float32 storage, so compare within its precision rather than exactly.
    expect(peaks[0]).toBeCloseTo(0.9, 6);
    expect(peaks[1]).toBeCloseTo(0.1, 6);
  });

  it("covers every sample and never reads past the end", () => {
    const samples = new Float32Array([0.2, 0.4, 0.6]);
    const exact = waveformPeaks(samples, 3);
    expect(exact).toHaveLength(3);
    for (const [index, value] of [0.2, 0.4, 0.6].entries())
      expect(exact[index]).toBeCloseTo(value, 6);
    expect(waveformPeaks(samples, 5)).toHaveLength(5);
    expect(waveformPeaks(samples, 5).every((value) => value > 0)).toBe(true);
  });

  it("returns nothing to draw rather than failing on empty input", () => {
    expect(waveformPeaks(new Float32Array(), 10)).toEqual([]);
    expect(waveformPeaks(new Float32Array([0.5]), 0)).toEqual([]);
  });

  it("lifts quiet narration to fill the height, and leaves silence flat", () => {
    expect(normalizePeaks([0.1, 0.05, 0.2])).toEqual([0.5, 0.25, 1]);
    expect(normalizePeaks([0, 0])).toEqual([0, 0]);
    expect(normalizePeaks([])).toEqual([]);
  });

  it("maps a click to a position inside the clip", () => {
    expect(seekTime(50, 100, 10)).toBe(5);
    expect(seekTime(-10, 100, 10)).toBe(0);
    expect(seekTime(500, 100, 10)).toBe(10);
    expect(seekTime(50, 0, 10)).toBe(0);
    expect(seekTime(50, 100, 0)).toBe(0);
    expect(seekTime(Number.NaN, 100, 10)).toBe(0);
  });

  it("reports progress as a clamped fraction", () => {
    expect(playedFraction(5, 10)).toBe(0.5);
    expect(playedFraction(20, 10)).toBe(1);
    expect(playedFraction(-1, 10)).toBe(0);
    expect(playedFraction(5, 0)).toBe(0);
    expect(playedFraction(Number.NaN, 10)).toBe(0);
  });

  it("reads a clip position as minutes and seconds", () => {
    expect(clipTime(0)).toBe("0:00");
    expect(clipTime(9.7)).toBe("0:09");
    expect(clipTime(65)).toBe("1:05");
    expect(clipTime(600)).toBe("10:00");
    expect(clipTime(-1)).toBe("0:00");
    expect(clipTime(Number.NaN)).toBe("0:00");
  });
});

describe("translation", () => {
  const sources = new Map([
    ["hello", "Hello"],
    ["bye", "Bye"],
    ["wave", "Wave"],
    ["own", "Mine"],
  ]);
  const spanish: MediaAsset[] = [
    asset({ key: "hello" }),
    asset({ key: "bye", script: "Adiós", translatedFrom: "Goodbye" }),
    asset({ key: "wave", script: "Hola", translatedFrom: "Wave" }),
    asset({ key: "own", script: "Mío" }),
  ];
  const running = {
    kind: "media-text",
    status: "running",
    createdAt: "2026-09-23T10:00:00Z",
    mediaText: { language: "es-MX", assetKey: "wave", translation: { from: "Wave" } },
  } as unknown as ActivityRunSummary;

  it("marks what was never translated, what the default line has since changed, and what is being translated", () => {
    const statuses = speechStatuses(spanish, indexRuns([running]), "es-MX", sources);
    expect(statuses.map((status) => [status.key, status.translation])).toEqual([
      ["hello", "missing"],
      ["bye", "outdated"],
      ["wave", "translating"],
      // Written by someone, with no source recorded: it stands.
      ["own", undefined],
    ]);
    expect(statuses.filter((status) => inSpeechFilter(status, "translate"))).toHaveLength(3);
  });

  it("marks nothing without the default language's scripts to compare against", () => {
    expect(
      speechStatuses(spanish, indexRuns([]), "es-MX").some((status) => status.translation),
    ).toBe(false);
  });
});

describe("trimming a clip", () => {
  it("reads a drag as a stretch of the clip, and a click as none", () => {
    expect(selectionFromDrag(150, 50, 200, 4)).toEqual({ start: 1, end: 3 });
    expect(selectionFromDrag(100, 101, 200, 4)).toBeNull();
    expect(selectionFromDrag(0, 100, 0, 4)).toBeNull();
  });

  it("reads two marked moments as a selection either way round, and says what remains", () => {
    expect(selectionBetween(2.5, 1)).toEqual({ start: 1, end: 2.5 });
    expect(selectionBetween(1, 1.01)).toBeNull();
    expect(remainingLength(4, { start: 1, end: 2.5 })).toBe(2.5);
  });

  it("finds the selection's edge under the pointer, and moves only that edge", () => {
    const selection = { start: 1, end: 3 };
    // 200 px for 4 s: the edges are at 50 px and 150 px.
    expect(selectionEdgeAt(52, 200, 4, selection)).toBe("start");
    expect(selectionEdgeAt(147, 200, 4, selection)).toBe("end");
    expect(selectionEdgeAt(100, 200, 4, selection)).toBeNull();
    expect(selectionEdgeAt(50, 0, 4, selection)).toBeNull();
    expect(moveSelectionEdge(selection, "start", 0.5, 4)).toEqual({ start: 0.5, end: 3 });
    expect(moveSelectionEdge(selection, "end", 9, 4)).toEqual({ start: 1, end: 4 });
    expect(moveSelectionEdge(selection, "start", -1, 4)).toEqual({ start: 0, end: 3 });
    // Dragged past the other edge, it stops the shortest selection short of it.
    expect(moveSelectionEdge(selection, "start", 3.5, 4).start).toBeCloseTo(2.95);
    expect(moveSelectionEdge(selection, "end", 0, 4).end).toBeCloseTo(1.05);
  });
});
