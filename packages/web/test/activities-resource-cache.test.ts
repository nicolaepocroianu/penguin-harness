import { describe, expect, it } from "vitest";
import type { ActivityRun, ActivityRunSummary } from "@prismshadow/penguin-server/api";
import { runStarted } from "../src/features/activities/activity-client";
import { ResourceCache } from "../src/features/activities/resource-cache";
import { memoryActivity, settle } from "./activity-memory-api";

describe("the activity's resource cache", () => {
  it("shares a read of one version between the views that ask for it at once", async () => {
    const { api, calls } = memoryActivity();
    const cache = new ResourceCache();
    const chip = cache.read(api.tests.report, "run_1:succeeded|r1");
    const panel = cache.read(api.tests.report, "run_1:succeeded|r1");
    expect(calls.map((call) => [call.method, call.path])).toEqual([["GET", "test-report"]]);
    calls[0]!.answer({ report: null });
    expect(await chip).toEqual({ report: null });
    expect(await panel).toEqual({ report: null });
    expect(cache.peek(api.tests.report)).toEqual({
      data: { report: null },
      error: null,
      version: "run_1:succeeded|r1",
    });
  });

  it("drops a read a newer version superseded, whenever it answers", async () => {
    const { api, calls } = memoryActivity();
    const cache = new ResourceCache();
    let heard = 0;
    cache.subscribe(api.quality.report, () => heard++);
    void cache.read(api.quality.report, "old");
    void cache.read(api.quality.report, "new");
    expect(calls).toHaveLength(2);
    calls[1]!.answer("fresh");
    await settle();
    calls[0]!.answer("stale");
    await settle();
    expect(cache.peek(api.quality.report).data).toBe("fresh");
    expect(heard).toBe(1);
  });

  it("keeps the last value through a failed read, and clears the failure with the next", async () => {
    const { api, calls } = memoryActivity();
    const cache = new ResourceCache();
    void cache.read(api.deploy.state, "1");
    calls[0]!.answer({ stages: [] });
    await settle();
    const failed = cache.read(api.deploy.state, "2");
    calls[1]!.refuse(new Error("down"));
    await expect(failed).rejects.toThrow("down");
    expect(cache.peek(api.deploy.state)).toMatchObject({ data: { stages: [] }, version: "2" });
    expect(cache.peek(api.deploy.state).error).toBeInstanceOf(Error);
    void cache.read(api.deploy.state, "3");
    calls[2]!.answer({ stages: [{}] });
    await settle();
    expect(cache.peek(api.deploy.state)).toEqual({
      data: { stages: [{}] },
      error: null,
      version: "3",
    });
  });

  it("reads afresh when asked to, never joining a read already in flight", () => {
    const { api, calls } = memoryActivity();
    const cache = new ResourceCache();
    void cache.read(api.deploy.state, "page");
    void cache.refresh(api.deploy.state);
    void cache.refresh(api.deploy.state);
    expect(calls).toHaveLength(3);
  });

  it("shows a run that just started at once, and has whoever watches the history read it", () => {
    const { api } = memoryActivity();
    const cache = new ResourceCache();
    const older = { runId: "old", status: "succeeded" } as ActivityRunSummary;
    cache.put(api.runs.list, [older]);
    let reads = 0;
    const stop = cache.watch(api.runs.list, () => reads++);
    const run = { runId: "new", status: "running", candidate: null } as unknown as ActivityRun;
    runStarted({ api, cache }, run);
    expect(cache.peek(api.runs.list).data).toEqual([
      { runId: "new", status: "running", hasCandidate: false },
      older,
    ]);
    expect(reads).toBe(1);
    stop();
    cache.invalidate(api.runs.list);
    expect(reads).toBe(1);
  });

  it("keeps each activity's resources apart", () => {
    const one = memoryActivity("p", "a1").api;
    const two = memoryActivity("p", "a2").api;
    const cache = new ResourceCache();
    cache.put(one.tests.report, "one");
    expect(cache.peek(two.tests.report).data).toBeUndefined();
  });
});
