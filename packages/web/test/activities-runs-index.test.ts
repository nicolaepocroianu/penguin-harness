import { describe, expect, it } from "vitest";
import type { ActivityRunSummary } from "@prismshadow/penguin-server/api";
import { indexRuns } from "../src/features/activities/runs-index";

const run = (extra: Partial<ActivityRunSummary>): ActivityRunSummary =>
  ({
    runId: "r",
    kind: "spec",
    status: "succeeded",
    hasCandidate: true,
    inputRevision: "rev",
    createdAt: "2026-10-12T10:00:00.000Z",
    sessionId: null,
    error: null,
    ...extra,
  }) as ActivityRunSummary;

const ids = (runs: readonly ActivityRunSummary[]) => runs.map((entry) => entry.runId);

describe("the runs index", () => {
  it("reads newest by when a run started, whatever order the list is in", () => {
    const older = run({ runId: "older", kind: "test", createdAt: "2026-10-12T09:00:00.000Z" });
    const newer = run({ runId: "newer", kind: "test", createdAt: "2026-10-12T11:00:00.000Z" });
    const middle = run({ runId: "middle", kind: "test", createdAt: "2026-10-12T10:00:00.000Z" });
    expect(indexRuns([older, newer, middle]).latest("test")?.runId).toBe("newer");
    expect(ids(indexRuns([middle, older, newer]).of("test"))).toEqual(["newer", "middle", "older"]);
  });

  it("does not take a run put in front of the list for the newest", () => {
    // A run the page adds as it starts sits first, though a later one is already listed.
    const started = run({
      runId: "started",
      kind: "module",
      createdAt: "2026-10-12T09:00:00.000Z",
    });
    const listed = run({ runId: "listed", kind: "module", createdAt: "2026-10-12T09:30:00.000Z" });
    expect(indexRuns([started, listed]).latest("module")?.runId).toBe("listed");
  });

  it("breaks a tie in start time by run id, as the server lists them", () => {
    const at = "2026-10-12T10:00:00.000Z";
    const a = run({ runId: "run_a", kind: "quality", createdAt: at });
    const b = run({ runId: "run_b", kind: "quality", createdAt: at });
    expect(indexRuns([a, b]).latest("quality")?.runId).toBe("run_b");
    expect(indexRuns([b, a]).latest("quality")?.runId).toBe("run_b");
  });

  it("answers a newest run whatever its status, and nothing for a kind with no runs", () => {
    const runs = indexRuns([
      run({ runId: "done", kind: "phonemes", createdAt: "2026-10-12T09:00:00.000Z" }),
      run({ runId: "failed", kind: "phonemes", status: "failed" }),
    ]);
    expect(runs.latest("phonemes")?.runId).toBe("failed");
    expect(runs.latest("critique")).toBeUndefined();
    expect(runs.of("critique")).toEqual([]);
  });

  it("matches a target where each kind keeps it", () => {
    const runs = indexRuns([
      run({ runId: "audio", kind: "audio", audio: { language: "en-US", assetKey: "a" } as never }),
      run({ runId: "image", kind: "image", image: { language: "en-US", assetKey: "a" } as never }),
      run({
        runId: "text",
        kind: "media-text",
        mediaText: { language: "en-US", assetKey: "a", type: "audio", text: "" },
      }),
      run({
        runId: "composition",
        kind: "composition",
        composition: { language: "en-US", assetKey: "a" } as never,
      }),
      run({ runId: "video", kind: "video", video: { language: "en-US", assetKey: "a" } as never }),
      run({
        runId: "timeline",
        kind: "timeline",
        timelineEdit: { language: "en-US", assetKey: "a" } as never,
      }),
      run({
        runId: "critique",
        kind: "critique",
        critique: { language: "en-US", assetKey: "a", recordingRunId: "v", compositionRunId: "c" },
      }),
      run({ runId: "phonemes", kind: "phonemes", phonemes: { language: "en-US", words: [] } }),
    ]);
    const target = { language: "en-US", assetKey: "a" };
    for (const kind of [
      "audio",
      "image",
      "media-text",
      "composition",
      "video",
      "timeline",
      "critique",
    ] as const)
      expect(runs.latest(kind, target)?.runId).toBe(kind === "media-text" ? "text" : kind);
    expect(runs.latest("audio", { language: "es-MX", assetKey: "a" })).toBeUndefined();
    expect(runs.latest("audio", { language: "en-US", assetKey: "b" })).toBeUndefined();
    // A phonemes run is for a language, not an asset.
    expect(runs.latest("phonemes", { language: "en-US" })?.runId).toBe("phonemes");
    expect(runs.latest("phonemes", target)).toBeUndefined();
  });

  it("keeps one asset's runs apart from another's of the same kind", () => {
    const audio = (runId: string, language: string, assetKey: string, createdAt: string) =>
      run({ runId, kind: "audio", createdAt, audio: { language, assetKey } as never });
    const runs = indexRuns([
      audio("hello-new", "en-US", "hello", "2026-10-12T11:00:00.000Z"),
      audio("bye", "en-US", "bye", "2026-10-12T12:00:00.000Z"),
      audio("hola", "es-MX", "hello", "2026-10-12T13:00:00.000Z"),
      audio("hello-old", "en-US", "hello", "2026-10-12T09:00:00.000Z"),
    ]);
    expect(ids(runs.of("audio", { language: "en-US", assetKey: "hello" }))).toEqual([
      "hello-new",
      "hello-old",
    ]);
    expect(ids(runs.of("audio", { language: "en-US" }))).toEqual(["bye", "hello-new", "hello-old"]);
    expect(ids(runs.of("audio"))).toHaveLength(4);
  });

  it("matches no target for a kind that has none", () => {
    const runs = indexRuns([run({ runId: "m", kind: "module" })]);
    expect(runs.latest("module")?.runId).toBe("m");
    expect(runs.latest("module", { language: "en-US" })).toBeUndefined();
  });

  it("knows what is under way, overall and for one kind and asset", () => {
    const idle = indexRuns([run({ runId: "done" })]);
    expect(idle.busy).toBe(false);
    expect(idle.running).toEqual([]);

    const runs = indexRuns([
      run({
        runId: "spec",
        kind: "spec",
        status: "running",
        createdAt: "2026-10-12T09:00:00.000Z",
      }),
      run({
        runId: "speech",
        kind: "audio",
        status: "running",
        audio: { language: "en-US", assetKey: "hello" } as never,
      }),
    ]);
    expect(runs.busy).toBe(true);
    expect(ids(runs.running)).toEqual(["speech", "spec"]);
    expect(runs.isRunning("audio", { language: "en-US", assetKey: "hello" })).toBe(true);
    expect(runs.isRunning("audio", { language: "es-MX", assetKey: "hello" })).toBe(false);
    expect(runs.isRunning("image", { language: "en-US", assetKey: "hello" })).toBe(false);
    expect(runs.isRunning("spec")).toBe(true);
  });

  it("is built once per list, and again for a new one", () => {
    const list = [run({ runId: "a", kind: "test" })];
    expect(indexRuns(list)).toBe(indexRuns(list));
    const next = [
      run({ runId: "b", kind: "test", createdAt: "2026-10-12T12:00:00.000Z" }),
      ...list,
    ];
    expect(indexRuns(next).latest("test")?.runId).toBe("b");
    expect(indexRuns(list).latest("test")?.runId).toBe("a");
  });
});
