import { describe, expect, it } from "vitest";
import type { ActivityRunSummary } from "@waterford/waf-harness-server/api";
import { playUrl } from "../src/features/activities/sandbox";
import { playingModuleRunId } from "../src/features/activities/preview";
import { indexRuns } from "../src/features/activities/runs-index";
import { readFileSync } from "node:fs";

describe("the module the sandbox plays", () => {
  it("changes only after assembly succeeds, while a valid pin keeps its build", () => {
    const module = (runId: string, status: ActivityRunSummary["status"], createdAt: string) =>
      ({ runId, kind: "module", status, createdAt }) as ActivityRunSummary;
    const old = module("old", "succeeded", "2026-10-01");
    const next = module("next", "running", "2026-10-02");
    const built = { ...next, status: "succeeded" as const };
    const playing = (runs: ActivityRunSummary[], pinned?: string) =>
      playingModuleRunId(indexRuns(runs), pinned);
    expect(playing([next, old])).toBe("old");
    expect(playing([built, old])).toBe("next");
    expect(playing([built, old], "old")).toBe("old");
    expect(playing([next, old], "next")).toBe("old");
    expect(playing([built, old], "missing")).toBe("next");
    expect(playing([next])).toBeNull();
  });

  it("refreshes status and clears the previous failure when assembly changes", () => {
    const source = readFileSync(
      new URL("../src/features/activities/sandbox-panel.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("[refresh, build, revision, moduleRunId, base]");
    expect(source).toContain("setReport(null)");
    expect(source).toContain('revision={`${revision}:${moduleRunId ?? ""}`}');
  });
});

describe("the link that plays an activity", () => {
  it("names the activity, and carries only the overrides an author chose", () => {
    expect(playUrl("p 1", "act_1")).toBe("/api/projects/p%201/activities/act_1/sandbox/play");
    expect(playUrl("p", "a", { language: "es-MX", scene: "intro" })).toBe(
      "/api/projects/p/activities/a/sandbox/play?languageCode=es-MX&startSceneId=intro",
    );
  });
});
