/**
 * The activity run store and the activity lock, through their interfaces: runs are recorded,
 * read, settled and found by their Session against a real database, and the lock that
 * authoring and generation share keeps "no run is working on this activity" true for as long
 * as the one who checked it holds the activity.
 */
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { wire } from "@prismshadow/penguin-core/kernel";
import type { ActivityDetail, ActivityRun } from "../src/activities/domain.js";
import type { ActivityAuthoring, ActivityGeneration } from "../src/mechanisms/activities.js";
import { isRunWorkspace, type ActivityRuns } from "../src/activities/run-store.js";
import { ActivityLockService } from "../src/activities/activity-lock.js";
import { apiClient, createTestApp, provisionUser, type TestApp } from "./helpers.js";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 25));

describe("ActivityRuns", () => {
  const apps: TestApp[] = [];
  afterEach(async () => {
    for (const t of apps.splice(0)) await t.cleanup();
  });

  async function setup() {
    const t = await createTestApp();
    apps.push(t);
    const owner = await provisionUser(t.app, "runstore");
    const client = apiClient(t.app, owner.cookie);
    const create = async (projectId: string, productCode: string): Promise<ActivityDetail> => {
      expect((await client.post("/api/projects", { projectId })).status).toBe(201);
      const response = await client.post(`/api/projects/${projectId}/activities`, {
        productCode,
        refNum: 1,
        title: `${productCode} 1`,
      });
      expect(response.status, await response.clone().text()).toBe(201);
      return (await response.json()) as ActivityDetail;
    };
    const activity = await create("runstore-work", "words");
    const runs = t.deps.tree.api<ActivityRuns>("ActivitiesModule", "ActivityRuns");
    let clock = 0;
    const newRun = (overrides: Partial<ActivityRun> = {}): ActivityRun => {
      clock += 1;
      return {
        kind: "spec",
        runId: `run_${String(clock).padStart(2, "0")}`,
        activityId: activity.id,
        projectId: "runstore-work",
        draftId: activity.draft.draftId,
        inputRevision: activity.draft.contentRevision,
        agentId: "default_agent",
        sessionId: null,
        status: "running",
        createdAt: `2026-10-12T00:00:${String(clock).padStart(2, "0")}.000Z`,
        finishedAt: null,
        error: null,
        candidate: null,
        ...overrides,
      } as ActivityRun;
    };
    return { t, client, create, activity, runs, newRun };
  }

  it("records an opened run as running, and settles it with its candidate", async () => {
    const { activity, runs, newRun } = await setup();
    const run = newRun({ sessionId: "s1" });
    runs.open(run);
    expect(runs.get("runstore-work", activity.id, run.runId)).toEqual(run);
    expect(runs.hasActive(activity.id)).toBe(true);
    expect(runs.running().map((r) => r.runId)).toEqual([run.runId]);
    const { candidate: _, ...summary } = run;
    expect(runs.summaries("runstore-work", activity.id)).toEqual([
      { ...summary, hasCandidate: false },
    ]);

    const settled: ActivityRun = {
      ...run,
      status: "succeeded",
      finishedAt: "2026-10-12T01:00:00.000Z",
      candidate: '{"ok":true}',
    };
    runs.save(settled);
    expect(runs.get("runstore-work", activity.id, run.runId)).toEqual(settled);
    expect(runs.hasActive(activity.id)).toBe(false);
    expect(runs.running()).toEqual([]);
    expect(runs.summaries("runstore-work", activity.id)[0]).toMatchObject({
      status: "succeeded",
      hasCandidate: true,
    });

    // A later save without a candidate keeps the one already kept.
    runs.save({ ...settled, candidate: null, error: "noted" });
    expect(runs.get("runstore-work", activity.id, run.runId)).toMatchObject({
      error: "noted",
      candidate: '{"ok":true}',
    });
  });

  it("keeps a run as it always was: status and kind beside the record, the candidate apart", async () => {
    const { t, activity, runs, newRun } = await setup();
    const run = newRun({ kind: "image" });
    runs.open(run);
    runs.save({ ...run, status: "failed", candidate: "bytes" });
    const row = t.deps.db
      .prepare("SELECT status, kind, record_json FROM activity_runs WHERE run_id = ?")
      .get(run.runId) as { status: string; kind: string; record_json: string };
    expect(row.status).toBe("failed");
    expect(row.kind).toBe("image");
    const { candidate: _, kind: _kind, ...metadata } = run;
    expect(JSON.parse(row.record_json)).toEqual({
      ...metadata,
      status: "failed",
      hasCandidate: true,
    });
    expect(
      t.deps.db
        .prepare("SELECT candidate FROM activity_run_candidates WHERE run_id = ?")
        .get(run.runId),
    ).toEqual({ candidate: "bytes" });
    expect(runs.get("runstore-work", activity.id, "run_missing")).toBeNull();
  });

  it("saves nothing for a run that was never opened", async () => {
    const { activity, runs, newRun } = await setup();
    const run = newRun({ status: "succeeded", candidate: "x" });
    runs.save(run);
    expect(runs.get("runstore-work", activity.id, run.runId)).toBeNull();
    expect(runs.summaries("runstore-work", activity.id)).toEqual([]);
  });

  it("lists an activity's runs newest first, narrowed by kind, status and count", async () => {
    const { activity, runs, newRun } = await setup();
    const settle = (run: ActivityRun, status: ActivityRun["status"]) => {
      runs.open(run);
      runs.save({ ...run, status });
      return run.runId;
    };
    const oldModule = settle(newRun({ kind: "module" }), "succeeded");
    const failedModule = settle(newRun({ kind: "module" }), "failed");
    const spec = settle(newRun(), "succeeded");
    const newModule = settle(newRun({ kind: "module" }), "succeeded");

    const ids = (query?: Parameters<ActivityRuns["summaries"]>[2]) =>
      runs.summaries("runstore-work", activity.id, query).map((run) => run.runId);
    expect(ids()).toEqual([newModule, spec, failedModule, oldModule]);
    expect(ids({ limit: 2 })).toEqual([newModule, spec]);
    expect(ids({ kind: "module", status: "succeeded" })).toEqual([newModule, oldModule]);
    expect(ids({ kind: "module", status: "failed", limit: 1 })).toEqual([failedModule]);
    expect(ids({ kind: "audio" })).toEqual([]);
  });

  it("reads one activity's runs only", async () => {
    const { create, activity, runs, newRun } = await setup();
    const other = await create("runstore-other", "letters");
    const mine = newRun();
    runs.open(mine);
    const theirs = newRun({
      activityId: other.id,
      projectId: "runstore-other",
      draftId: other.draft.draftId,
    });
    runs.open(theirs);
    expect(runs.get("runstore-work", other.id, mine.runId)).toBeNull();
    expect(runs.get("runstore-other", activity.id, mine.runId)).toBeNull();
    expect(runs.summaries("runstore-work", activity.id).map((run) => run.runId)).toEqual([
      mine.runId,
    ]);
    expect(
      runs
        .running()
        .map((run) => run.runId)
        .sort(),
    ).toEqual([mine.runId, theirs.runId].sort());
    // One running run per activity, whoever opens it.
    expect(() => runs.open(newRun())).toThrow();
  });

  it("gives each run its own folder under the server root", async () => {
    const { t, runs } = await setup();
    const folder = runs.workspace("run_01");
    expect(folder).toBe(path.join(t.root, "activity-runs", "run_01"));
    expect(isRunWorkspace(t.root, folder)).toBe(true);
    expect(isRunWorkspace(t.root, path.join(folder, "sub"))).toBe(true);
    expect(isRunWorkspace(t.root, path.dirname(folder))).toBe(false);
    expect(isRunWorkspace(t.root, t.root)).toBe(false);
  });

  it("finds runs by their Session, per project", async () => {
    const { create, activity, runs, newRun } = await setup();
    const other = await create("runstore-other", "letters");
    const settle = (run: ActivityRun) => {
      runs.open(run);
      runs.save({ ...run, status: "succeeded" });
    };
    settle(newRun({ sessionId: "s1" }));
    settle(newRun({ kind: "audio", sessionId: null }));
    settle(
      newRun({
        activityId: other.id,
        projectId: "runstore-other",
        draftId: other.draft.draftId,
        sessionId: "s9",
      }),
    );

    expect([...runs.sessionActivities("runstore-work")]).toEqual([["s1", activity.id]]);
    expect([...runs.sessionActivities("runstore-other")]).toEqual([["s9", other.id]]);
    expect(runs.activityOfSession("s1")).toBe(activity.id);
    expect(runs.activityOfSession("s-unknown")).toBeUndefined();
  });
});

describe("ActivityLock", () => {
  it("runs one operation per activity at a time, and different activities side by side", async () => {
    const lock = wire(ActivityLockService, {});
    const order: string[] = [];
    const first = deferred();
    const a1 = lock.run("a", async () => {
      order.push("a1 start");
      await first.promise;
      order.push("a1 end");
    });
    const a2 = lock.run("a", async () => {
      order.push("a2");
    });
    const b = lock.run("b", async () => {
      order.push("b");
    });
    await b;
    expect(order).toEqual(["a1 start", "b"]);
    first.resolve();
    await Promise.all([a1, a2]);
    expect(order).toEqual(["a1 start", "b", "a1 end", "a2"]);
  });

  it("lets an operation join the hold it is called from, and nothing that outlives it", async () => {
    const lock = wire(ActivityLockService, {});
    const order: string[] = [];
    const later = deferred();
    let leftRunning: Promise<void> | null = null;
    await lock.run("a", async () => {
      await lock.join("a", async () => {
        order.push("joined");
      });
      // Started inside the hold, it reaches the lock only after the hold ended.
      leftRunning = later.promise.then(() =>
        lock.join("a", async () => {
          order.push("after");
        }),
      );
    });
    const held = deferred();
    const holder = lock.run("a", async () => {
      order.push("next holder");
      await held.promise;
    });
    later.resolve();
    await tick();
    expect(order).toEqual(["joined", "next holder"]);
    held.resolve();
    await holder;
    await leftRunning;
    expect(order).toEqual(["joined", "next holder", "after"]);
  });
});

describe("a run and the activity's archive", () => {
  it("cannot interleave: the archive waits for the run being opened, then refuses", async () => {
    const t = await createTestApp();
    try {
      const owner = await provisionUser(t.app, "runlock");
      const client = apiClient(t.app, owner.cookie);
      expect((await client.post("/api/projects", { projectId: "runlock-work" })).status).toBe(201);
      const created = await client.post("/api/projects/runlock-work/activities", {
        productCode: "words",
        refNum: 1,
        title: "words 1",
      });
      expect(created.status, await created.clone().text()).toBe(201);
      const activity = (await created.json()) as ActivityDetail;
      const authoring = t.deps.tree.api<ActivityAuthoring>("ActivitiesModule", "ActivityAuthoring");
      const generation = t.deps.tree.api<ActivityGeneration>(
        "ActivitiesModule",
        "ActivityGeneration",
      );
      const runs = t.deps.tree.api<ActivityRuns>("ActivitiesModule", "ActivityRuns");

      // Hold the run's opening after it read the activity and before it records the run.
      const read = authoring.getActivity.bind(authoring);
      const entered = deferred();
      const release = deferred();
      vi.spyOn(authoring, "getActivity").mockImplementationOnce(async (...args) => {
        const activity = await read(...args);
        entered.resolve();
        await release.promise;
        return activity;
      });
      const opening = generation.openDeterministic("runlock-work", activity.id, "quality");
      await entered.promise;

      let archived: "pending" | "archived" | "refused" = "pending";
      const archive = authoring.archiveActivity("runlock-work", activity.id).then(
        () => {
          archived = "archived";
        },
        (error: { code?: string }) => {
          archived = "refused";
          expect(error.code).toBe("run_active");
        },
      );
      await tick();
      // The archive waits for the activity's lock rather than checking a run not yet recorded.
      expect(archived).toBe("pending");
      release.resolve();
      const run = await opening;
      await archive;
      expect(archived).toBe("refused");
      expect(runs.hasActive(activity.id)).toBe(true);
      expect(
        (await client.get(`/api/projects/runlock-work/activities/${activity.id}`)).status,
      ).toBe(200);
      expect(run.status).toBe("running");
    } finally {
      vi.restoreAllMocks();
      await t.cleanup();
    }
  });
});
