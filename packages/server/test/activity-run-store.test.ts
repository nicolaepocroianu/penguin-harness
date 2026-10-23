/**
 * The activity run store and the activity lock, through their interfaces: runs are recorded,
 * read, settled and found by their Session against a real database, and the lock that
 * authoring and generation share keeps "no run is working on this activity" true for as long
 * as the one who checked it holds the activity.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectDir } from "@waterford/waf-harness-core";
import { wire } from "@waterford/waf-harness-core/kernel";
import type { ActivityDetail, ActivityRun } from "../src/activities/domain.js";
import type { ActivityAuthoring, ActivityGeneration } from "../src/mechanisms/activities.js";
import { isRunWorkspace, type ActivityRuns } from "../src/activities/run-store.js";
import { ActivityLockService } from "../src/activities/activity-lock.js";
import { modulePackagesRoot } from "../src/activities/run-kinds/module.js";
import { fakeModuleBuilder } from "./activity-sandbox-wiring.js";
import {
  apiClient,
  createTestApp,
  provisionUser,
  type TestApp,
  type TestAppOptions,
} from "./helpers.js";

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

  async function setup(options: TestAppOptions = {}) {
    const t = await createTestApp(options);
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

  it("removes a deleted project's run folders, and nothing a link in one points to", async () => {
    const { t, client, create, runs, newRun } = await setup();
    const added = await client.post("/api/projects/runstore-work/activities", {
      productCode: "letters",
      refNum: 1,
      title: "letters 1",
    });
    expect(added.status, await added.clone().text()).toBe(201);
    const second = (await added.json()) as ActivityDetail;
    const other = await create("runstore-other", "numbers");
    const settle = (run: ActivityRun) => {
      runs.open(run);
      runs.save({ ...run, status: "succeeded" });
      return run.runId;
    };
    const built = settle(newRun({ kind: "module" }));
    const spec = settle(newRun({ activityId: second.id, draftId: second.draft.draftId }));
    const theirs = settle(
      newRun({ activityId: other.id, projectId: "runstore-other", draftId: other.draft.draftId }),
    );
    expect(runs.projectRunIds("runstore-work").sort()).toEqual([built, spec].sort());

    // A module run's packages are linked in from the cache every module run shares.
    const packages = path.join(modulePackagesRoot(t.root), "set", "node_modules");
    await fs.mkdir(path.join(packages, "webpack"), { recursive: true });
    await fs.writeFile(path.join(packages, "webpack", "package.json"), "{}");
    const module = path.join(runs.workspace(built), "module");
    await fs.mkdir(module, { recursive: true });
    await fs.writeFile(path.join(module, "definition.json"), "{}");
    // A junction on Windows, which needs no privilege; elsewhere a directory symlink.
    await fs.symlink(packages, path.join(module, "node_modules"), "junction");
    for (const runId of [spec, theirs]) {
      await fs.mkdir(runs.workspace(runId), { recursive: true });
      await fs.writeFile(path.join(runs.workspace(runId), "input.json"), "{}");
    }

    expect((await client.delete("/api/projects/runstore-work")).status).toBe(204);
    for (const runId of [built, spec])
      await expect(fs.stat(runs.workspace(runId))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(path.join(packages, "webpack", "package.json"), "utf8")).toBe("{}");
    expect(await fs.readFile(path.join(runs.workspace(theirs), "input.json"), "utf8")).toBe("{}");
    expect(runs.projectRunIds("runstore-work")).toEqual([]);
    expect(runs.projectRunIds("runstore-other")).toEqual([theirs]);
  });

  it("removes run folders only: an id that names none removes nothing", async () => {
    const { t, runs } = await setup();
    await fs.mkdir(runs.workspace("run_kept"), { recursive: true });
    await fs.writeFile(path.join(t.root, "kept.txt"), "kept");
    await runs.removeWorkspaces(["", ".", "..", "../kept.txt", "run_missing"]);
    expect(await fs.readFile(path.join(t.root, "kept.txt"), "utf8")).toBe("kept");
    expect((await fs.stat(runs.workspace("run_kept"))).isDirectory()).toBe(true);
  });

  it("removes a deleted project's run folders even when its own folder stays, and logs each left", async () => {
    const lines: string[] = [];
    const { t, client, runs, newRun } = await setup({ log: (line) => lines.push(line) });
    const [gone, held] = [newRun(), newRun()].map((run) => {
      runs.open(run);
      runs.save({ ...run, status: "succeeded" });
      return run.runId;
    });
    for (const runId of [gone!, held!]) {
      await fs.mkdir(runs.workspace(runId), { recursive: true });
      await fs.writeFile(path.join(runs.workspace(runId), "input.json"), "{}");
    }
    // What Windows answers for a file a process still holds open, after rm's own retries.
    const busy = new Set(
      [projectDir(t.root, "runstore-work"), runs.workspace(held!)].map((dir) => path.resolve(dir)),
    );
    const rm = fs.rm;
    const refuse = vi.spyOn(fs, "rm").mockImplementation(async (target, options) => {
      if (busy.has(path.resolve(String(target))))
        throw Object.assign(new Error("resource busy or locked"), { code: "EBUSY" });
      return rm(target, options);
    });
    try {
      expect((await client.delete("/api/projects/runstore-work")).status).toBe(500);
    } finally {
      refuse.mockRestore();
    }
    await expect(fs.stat(runs.workspace(gone!))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(path.join(runs.workspace(held!), "input.json"), "utf8")).toBe("{}");
    expect(lines.filter((line) => line.includes("left in place"))).toEqual([
      `[activities] Run ${held}'s folder was left in place (EBUSY): ${runs.workspace(held!)}`,
    ]);
  });

  it("waits for a preview build in a run's folder before removing it, refusing new ones", async () => {
    const building = deferred<string>();
    const release = deferred();
    const { t, client, activity, runs, newRun } = await setup({
      moduleBuilder: {
        ...fakeModuleBuilder().builder,
        buildRun: async (workspace) => {
          building.resolve(workspace);
          await release.promise;
          // A build writes its bundle into the run's folder as it ends.
          await fs.mkdir(path.join(workspace, "dist", "debug"), { recursive: true });
          await fs.writeFile(path.join(workspace, "dist", "debug", "entry.js"), "");
          return { ok: true, log: "compiled" };
        },
      },
    });
    const run = newRun({ kind: "module" });
    runs.open(run);
    runs.save({ ...run, status: "succeeded" });
    const module = path.join(runs.workspace(run.runId), "module");
    await fs.mkdir(module, { recursive: true });
    await fs.writeFile(path.join(module, "definition.json"), "{}");
    const sandbox = `/api/projects/runstore-work/activities/${activity.id}/sandbox`;
    const link = new URL((await client.get(`${sandbox}/play`)).headers.get("location")!);
    // The page's files hang off the activity's play key, on the sandbox origin it was sent to.
    const played = (file: string) =>
      t.app.request(
        new URL(`/preview/activity/runstore-work~${activity.id}/${file}`, link.origin).toString(),
        { headers: { host: link.host } },
      );
    expect((await played("module/definition.json")).status).toBe(200);

    const build = client.post(`${sandbox}/build`, { force: true });
    expect(await building.promise).toBe(module);
    const deleting = client.delete("/api/projects/runstore-work");
    await tick();
    expect((await fs.stat(module)).isDirectory()).toBe(true);
    const refused = await client.post(`${sandbox}/build`, { force: true });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "project_deleting" } });
    release.resolve();
    expect((await build).status).toBe(200);

    expect((await deleting).status).toBe(204);
    await expect(fs.stat(runs.workspace(run.runId))).rejects.toMatchObject({ code: "ENOENT" });
    // The link plays nothing once its project is gone.
    expect((await played("module/definition.json")).status).toBe(404);
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
