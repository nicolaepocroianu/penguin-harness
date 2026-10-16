/**
 * Cleaning up activity runs, through its interface and its admin route, against a real database
 * and real run folders: what each category removes, what is never removed, that links are never
 * followed, that a dry run answers what the cleanup then removes, and that the media takes are
 * only looked at when asked for.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newId, type ActivityDetail, type ActivityRun } from "../src/activities/domain.js";
import type { ActivityPlayLinks } from "../src/activities/play-links.js";
import type { ActivityRunCleanup } from "../src/activities/run-cleanup.js";
import type {
  RunCleanupOptions,
  RunCleanupReport,
  RunCleanupReportResponse,
  RunStorageResponse,
} from "../src/activities/run-cleanup-types.js";
import { modulePackagesRoot } from "../src/activities/run-kinds/module.js";
import { runsRoot, type ActivityRuns } from "../src/activities/run-store.js";
import { WAF_WORKSPACE_DIR } from "../src/activities/waf-workspace.js";
import type { ActivityAuthoring } from "../src/mechanisms/activities.js";
import {
  apiClient,
  createTestApp,
  loginAdmin,
  provisionUser,
  type TestApp,
  type TestAppOptions,
} from "./helpers.js";

const PROJECT = "cleanup";
const ROUTE = "/api/admin/activity-run-cleanup";
const KEEP_ALL: RunCleanupOptions = { keepNewest: 5, orphanTakes: false };

describe("cleaning up activity runs", () => {
  const apps: TestApp[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const t of apps.splice(0)) await t.cleanup();
  });

  async function setup(options: TestAppOptions = {}) {
    const t = await createTestApp(options);
    apps.push(t);
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    expect((await admin.post("/api/projects", { projectId: PROJECT })).status).toBe(201);
    const create = async (productCode: string): Promise<ActivityDetail> => {
      const response = await admin.post(`/api/projects/${PROJECT}/activities`, {
        productCode,
        refNum: 1,
        title: `${productCode} 1`,
      });
      expect(response.status, await response.clone().text()).toBe(201);
      return (await response.json()) as ActivityDetail;
    };
    const activity = await create("words");
    const api = <T>(name: string) => t.deps.tree.api<T>("ActivitiesModule", name);
    const runs = api<ActivityRuns>("ActivityRuns");
    const cleanup = api<ActivityRunCleanup>("ActivityRunCleanup");
    let clock = 0;
    /** A run recorded as it ended (or still running), newer than every run before it. */
    const run = (overrides: Partial<ActivityRun> = {}, of: ActivityDetail = activity): string => {
      clock += 1;
      const recorded = {
        kind: "spec",
        runId: newId("run"),
        activityId: of.id,
        projectId: PROJECT,
        draftId: of.draft.draftId,
        inputRevision: of.draft.contentRevision,
        agentId: "default_agent",
        sessionId: null,
        status: "succeeded",
        createdAt: `2026-10-16T00:00:${String(clock).padStart(2, "0")}.000Z`,
        finishedAt: null,
        error: null,
        candidate: null,
        ...overrides,
      } as ActivityRun;
      runs.open({ ...recorded, status: "running" });
      runs.save(recorded);
      return recorded.runId;
    };
    /** Writes files into a run's folder, by relative path. */
    const files = async (runId: string, contents: Record<string, string>) => {
      for (const [file, body] of Object.entries(contents)) {
        const target = path.join(runs.workspace(runId), ...file.split("/"));
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, body);
      }
    };
    const present = (runId: string, file = "") =>
      fs.lstat(path.join(runs.workspace(runId), ...file.split("/").filter(Boolean))).then(
        () => true,
        () => false,
      );
    /** The dry run, then the cleanup; both answer the same while nothing changes between them. */
    const cleanUp = async (options: RunCleanupOptions): Promise<RunCleanupReport> => {
      const plan = await cleanup.plan(options);
      const applied = await cleanup.apply(options);
      expect(applied).toEqual(plan);
      return applied;
    };
    return { t, admin, create, activity, api, runs, cleanup, run, files, present, cleanUp };
  }

  const tallyOf = (report: RunCleanupReport) =>
    Object.fromEntries(
      report.categories.map(({ category, items, bytes }) => [category, { items, bytes }]),
    );

  it("removes finished module runs' staged media and own packages, never the linked ones", async () => {
    const { t, run, runs, files, present, cleanUp } = await setup();
    const shared = path.join(modulePackagesRoot(t.root), "set", "node_modules");
    await fs.mkdir(path.join(shared, "webpack"), { recursive: true });
    await fs.writeFile(path.join(shared, "webpack", "package.json"), "{}");
    const installed = run({ kind: "module" });
    await files(installed, {
      "media/loom/words/words-1/audios/en/a.mp3": "12345",
      "module/node_modules/left-pad/index.js": "123",
      "module/definition.json": "{}",
    });
    const linked = run({ kind: "module" });
    await files(linked, { "media/loom/words/words-1/images/en/b.png": "1234567", "module/a": "" });
    // A junction on Windows, which needs no privilege; elsewhere a directory symlink.
    await fs.symlink(
      shared,
      path.join(runs.workspace(linked), "module", "node_modules"),
      "junction",
    );
    const playing = run({ kind: "module" });
    await files(playing, { "media/x.mp3": "1", "module/node_modules/p/index.js": "1" });

    const report = await cleanUp(KEEP_ALL);
    expect(tallyOf(report)).toEqual({
      stagedCopies: { items: 3, bytes: 5 + 3 + 7 },
      olderRuns: { items: 0, bytes: 0 },
    });
    expect(report).toMatchObject({
      keepNewest: 5,
      orphanTakes: false,
      unreadActivities: 0,
      failed: 0,
    });
    expect(await present(installed, "media")).toBe(false);
    expect(await present(installed, "module/node_modules")).toBe(false);
    expect(await present(installed, "module/definition.json")).toBe(true);
    expect(await present(linked, "media")).toBe(false);
    // The link stays, and so does what it points to.
    expect(
      (
        await fs.lstat(path.join(runs.workspace(linked), "module", "node_modules"))
      ).isSymbolicLink(),
    ).toBe(true);
    expect(await fs.readFile(path.join(shared, "webpack", "package.json"), "utf8")).toBe("{}");
    // The build the preview plays keeps everything.
    expect(await present(playing, "media/x.mp3")).toBe(true);
    expect(await present(playing, "module/node_modules/p/index.js")).toBe(true);
    // Nothing is left to remove.
    expect(tallyOf(await cleanUp(KEEP_ALL)).stagedCopies).toEqual({ items: 0, bytes: 0 });
  });

  it("removes finished runs beyond the newest of their activity and kind", async () => {
    const { run, files, present, cleanUp } = await setup();
    const succeeded = run({ kind: "spec" });
    const failed = [1, 2, 3].map(() => run({ kind: "spec", status: "failed" }));
    const assists = [run({ kind: "assist" }), run({ kind: "assist" })];
    // Their folders are what they made: reports, a composition's page, a recording.
    const keptWhole = (["test", "quality", "composition", "video", "timeline"] as const).flatMap(
      (kind) => [run({ kind }), run({ kind })],
    );
    // An activity has one running run at most.
    const running = run({ kind: "assist", status: "running" });
    for (const runId of [succeeded, ...failed, running, ...assists, ...keptWhole])
      await files(runId, { "input.json": "12" });

    const report = await cleanUp({ keepNewest: 1, orphanTakes: false });
    // The newest spec run (failed) stays, and so does the newest that succeeded.
    expect(tallyOf(report).olderRuns).toEqual({ items: 3, bytes: 6 });
    expect(await present(failed[0]!)).toBe(false);
    expect(await present(failed[1]!)).toBe(false);
    expect(await present(failed[2]!)).toBe(true);
    expect(await present(succeeded)).toBe(true);
    // A running run counts among the newest, so the assist after it is past them; the newest
    // that succeeded stays.
    expect(await present(running)).toBe(true);
    expect(await present(assists[0]!)).toBe(false);
    expect(await present(assists[1]!)).toBe(true);
    for (const runId of keptWhole) expect(await present(runId)).toBe(true);

    expect(tallyOf(await cleanUp({ keepNewest: 1, orphanTakes: false })).olderRuns).toMatchObject({
      items: 0,
    });
  });

  it("never touches a pinned, playing, linked, repair, tested or ledger-held run", async () => {
    const { t, activity, api, run, files, present, cleanUp } = await setup();
    const repairedFrom = run({ kind: "module" });
    const testedOld = run({ kind: "module", inputRevision: "an-earlier-draft" });
    const tested = run({ kind: "module" });
    const linked = run({ kind: "module" });
    const pinned = run({ kind: "module" });
    const partSource = run({ kind: "module" });
    const deployed = run({ kind: "module" });
    const plain = run({ kind: "module" });
    const testRun = run({ kind: "test", test: { moduleRunId: tested } as ActivityRun["test"] });
    run({ kind: "test", test: { moduleRunId: testedOld } as ActivityRun["test"] });
    const repairTests = run({ kind: "test" });
    run({
      kind: "module",
      repair: { fromRunId: repairedFrom, testRunId: repairTests, testSha256: "x" },
    });
    const newest = run({ kind: "module" });
    const modules = [
      repairedFrom,
      testedOld,
      tested,
      linked,
      pinned,
      partSource,
      deployed,
      plain,
      newest,
    ];
    for (const runId of modules) await files(runId, { "media/a.mp3": "1", "module/a.txt": "1" });
    await files(testRun, { "reports/test.json": "{}" });

    const authoring = api<ActivityAuthoring>("ActivityAuthoring");
    await authoring.pinModuleRun(PROJECT, activity.id, pinned, activity.draft.contentRevision);
    api<ActivityPlayLinks>("ActivityPlayLinks").sign({
      projectId: PROJECT,
      activityId: activity.id,
      host: "localhost",
      shared: false,
      runId: linked,
    });
    t.deps.db
      .prepare(
        "INSERT INTO activity_draft_parts (activity_id, part, run_id, sha256, size, at) VALUES (?, 'module', ?, 'x', 1, 'now')",
      )
      .run(activity.id, partSource);
    t.deps.db
      .prepare(
        "INSERT INTO activity_outcome_facts (project_id, activity_id, run_id, fact, at, detail_json) VALUES (?, ?, ?, 'deployed', 'now', '{}')",
      )
      .run(PROJECT, activity.id, deployed);

    const report = await cleanUp({ keepNewest: 1, orphanTakes: false });
    // Only the build nothing holds, and the one tested before the draft changed, lose anything.
    expect(tallyOf(report)).toEqual({
      stagedCopies: { items: 0, bytes: 0 },
      olderRuns: { items: 2, bytes: 4 },
    });
    expect(await present(plain)).toBe(false);
    expect(await present(testedOld)).toBe(false);
    for (const runId of [repairedFrom, tested, linked, pinned, partSource, deployed, newest])
      expect(await present(runId, "media/a.mp3")).toBe(true);
    expect(await present(testRun, "reports/test.json")).toBe(true);
  });

  it("keeps every run of an activity whose draft cannot be read", async () => {
    const { admin, create, run, files, present, cleanUp } = await setup();
    const archived = await create("letters");
    const old = [1, 2].map(() => run({ kind: "spec" }, archived));
    for (const runId of old) await files(runId, { "input.json": "1" });
    expect((await admin.delete(`/api/projects/${PROJECT}/activities/${archived.id}`)).status).toBe(
      204,
    );

    const report = await cleanUp({ keepNewest: 1, orphanTakes: false });
    expect(report.unreadActivities).toBe(1);
    expect(tallyOf(report).olderRuns).toMatchObject({ items: 0 });
    for (const runId of old) expect(await present(runId)).toBe(true);
  });

  it("leaves a folder it cannot remove in place, names it in the log and counts it", async () => {
    const lines: string[] = [];
    const { run, runs, files, present, cleanup } = await setup({ log: (line) => lines.push(line) });
    const [busy, gone] = [run(), run()];
    run();
    for (const runId of [busy!, gone!]) await files(runId, { "input.json": "1" });
    const rm = fs.rm;
    vi.spyOn(fs, "rm").mockImplementation(async (target, options) => {
      if (path.resolve(String(target)) === path.resolve(runs.workspace(busy!)))
        throw Object.assign(new Error("resource busy or locked"), { code: "EBUSY" });
      return rm(target, options);
    });

    const report = await cleanup.apply({ keepNewest: 1, orphanTakes: false });
    expect(tallyOf(report).olderRuns).toEqual({ items: 1, bytes: 1 });
    expect(report.failed).toBe(1);
    expect(await present(busy!)).toBe(true);
    expect(await present(gone!)).toBe(false);
    expect(lines).toContain(
      `[activities] Run ${busy}'s folder was left in place (EBUSY): ${runs.workspace(busy!)}`,
    );
  });

  it("removes takes of runs it no longer has only when asked, in the managed checkout only", async () => {
    const { t, run, cleanUp } = await setup();
    const kept = run({ kind: "audio" });
    // Unasked, the media is not even looked at.
    const unasked = await cleanUp(KEEP_ALL);
    expect(unasked.categories.map(({ category }) => category)).toEqual([
      "stagedCopies",
      "olderRuns",
    ]);
    // An existing checkout is its owner's.
    expect(await cleanUp({ keepNewest: 5, orphanTakes: true })).toMatchObject({
      takesUnavailable: true,
      categories: [{}, {}, { category: "orphanTakes", items: 0, bytes: 0 }],
    });

    // The managed workspace, ready.
    const managed = path.join(t.root, WAF_WORKSPACE_DIR);
    for (const [repo, installed] of [
      ["framework", true],
      ["modules/navbar", true],
      ["media", false],
      ["waf-activity-data", false],
    ] as const) {
      await fs.mkdir(path.join(managed, repo, ".git"), { recursive: true });
      if (installed) await fs.mkdir(path.join(managed, repo, "node_modules"), { recursive: true });
    }
    t.deps.serverSettingsRepo.set("wafWorkspace", JSON.stringify({}));
    const candidates = path.join(managed, "media", "loom", "words", "words-1", "candidates");
    await fs.mkdir(candidates, { recursive: true });
    const orphan = `${newId("run")}.mp3`;
    await fs.writeFile(path.join(candidates, orphan), "1234");
    await fs.writeFile(path.join(candidates, `${kept}.mp3`), "12");
    await fs.writeFile(path.join(candidates, "notes.txt"), "1");
    // A candidates folder reached through a link is never looked into.
    const elsewhere = path.join(t.root, "elsewhere");
    await fs.mkdir(elsewhere);
    const theirs = `${newId("run")}.png`;
    await fs.writeFile(path.join(elsewhere, theirs), "1");
    await fs.mkdir(path.join(managed, "media", "loom", "words", "words-2"));
    await fs.symlink(
      elsewhere,
      path.join(managed, "media", "loom", "words", "words-2", "candidates"),
      "junction",
    );

    const report = await cleanUp({ keepNewest: 5, orphanTakes: true });
    expect(report.takesUnavailable).toBeUndefined();
    expect(tallyOf(report).orphanTakes).toEqual({ items: 1, bytes: 4 });
    expect((await fs.readdir(candidates)).sort()).toEqual([`${kept}.mp3`, "notes.txt"].sort());
    expect(await fs.readdir(elsewhere)).toEqual([theirs]);
  });

  it("reads the disk run folders take, never through a link", async () => {
    const { t, run, runs, files, admin } = await setup();
    const shared = path.join(modulePackagesRoot(t.root), "set", "node_modules");
    await fs.mkdir(shared, { recursive: true });
    await fs.writeFile(path.join(shared, "big.js"), "x".repeat(1000));
    const one = run({ kind: "module" });
    await files(one, { "module/a.js": "123" });
    await fs.symlink(shared, path.join(runs.workspace(one), "module", "node_modules"), "junction");
    await files(run(), { "input.json": "12345" });
    await fs.mkdir(runsRoot(t.root), { recursive: true });

    const response = await admin.get(`${ROUTE}/storage`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      storage: { bytes: 8, folders: 2 },
    } satisfies RunStorageResponse);
  });

  it("answers admins only, and refuses what it cannot keep to", async () => {
    const { t, admin, run, files, present } = await setup();
    const old = run();
    run();
    await files(old, { "input.json": "1" });
    const user = apiClient(t.app, (await provisionUser(t.app, "author")).cookie);
    for (const response of [
      await user.get(`${ROUTE}/storage`),
      await user.get(`${ROUTE}/plan`),
      await user.post(`${ROUTE}/apply`, { keepNewest: 1 }),
    ])
      expect(response.status).toBe(403);
    expect(await present(old)).toBe(true);

    for (const query of ["keepNewest=0", "keepNewest=101", "keepNewest=two", "orphanTakes=maybe"])
      expect((await admin.get(`${ROUTE}/plan?${query}`)).status).toBe(400);
    expect((await admin.post(`${ROUTE}/apply`, { keepNewest: 1.5 })).status).toBe(400);
    expect((await admin.post(`${ROUTE}/apply`, { keepNewest: 1, orphanTakes: "yes" })).status).toBe(
      400,
    );
    expect(await present(old)).toBe(true);

    const plan = (await (
      await admin.get(`${ROUTE}/plan?keepNewest=1`)
    ).json()) as RunCleanupReportResponse;
    expect(plan.report).toMatchObject({ keepNewest: 1, orphanTakes: false });
    expect(tallyOf(plan.report).olderRuns).toEqual({ items: 1, bytes: 1 });
    expect(await present(old)).toBe(true);
    // Without a choice, five of each kind are kept.
    expect(
      ((await (await admin.get(`${ROUTE}/plan`)).json()) as RunCleanupReportResponse).report
        .keepNewest,
    ).toBe(5);
    const applied = await admin.post(`${ROUTE}/apply`, { keepNewest: 1 });
    expect(applied.status).toBe(200);
    expect(((await applied.json()) as RunCleanupReportResponse).report).toEqual(plan.report);
    expect(await present(old)).toBe(false);
  });
});
