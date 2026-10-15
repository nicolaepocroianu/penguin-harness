/**
 * The player check of the build the preview plays, over HTTP: what a module build's checks
 * reported at assembly, in their order; why a build has none; and nothing without a build.
 *
 * The builds are module runs written straight into the run store, with the files a real
 * assembly leaves in its workspace; activity-acceptance-start.test.ts covers how a module run
 * stages its player check.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { playerCheckReport } from "../src/activities/acceptance-collect.js";
import type { PlayerCheckResponse } from "../src/activities/acceptance-types.js";
import { PLAYER_CHECK_DIR } from "../src/activities/waf-module.js";
import { versionsApp, type VersionsApp } from "./activity-version-fixtures.js";

const PROJECT = "versions-checks";
const RUN_OLD = `run_${"1".repeat(32)}`;
const RUN_NEW = `run_${"2".repeat(32)}`;

/** A module run of the activity, with what its player check left in its workspace. */
async function build(
  s: VersionsApp,
  runId: string,
  createdAt: string,
  check: { results?: unknown; staged?: boolean; record?: Record<string, unknown> } = {},
) {
  const dir = path.join(s.t.root, "activity-runs", runId, PLAYER_CHECK_DIR);
  await fs.mkdir(path.join(s.t.root, "activity-runs", runId, "module"), { recursive: true });
  if (check.staged !== false) await fs.mkdir(dir, { recursive: true });
  if (check.results !== undefined)
    await fs.writeFile(
      path.join(dir, "acceptance-results.json"),
      typeof check.results === "string" ? check.results : JSON.stringify(check.results),
    );
  const finishedAt = createdAt.replace("10:00", "10:17");
  s.t.deps.db
    .prepare(
      "INSERT INTO activity_runs (run_id, project_id, activity_id, status, created_at, kind, record_json) VALUES (?, ?, ?, 'succeeded', ?, 'module', ?)",
    )
    .run(
      runId,
      s.project,
      s.activity.id,
      createdAt,
      JSON.stringify({
        runId,
        status: "succeeded",
        kind: "module",
        createdAt,
        finishedAt,
        ...check.record,
      }),
    );
}

const PASSED = {
  criterion: "Every scene starts",
  testName: "scenes start",
  status: "passed",
  durationMs: 1200,
  error: null,
};
const FAILED = {
  criterion: "A wrong answer is told so",
  testName: "wrong answer",
  status: "failed",
  durationMs: 3400,
  error: "No feedback after 15 s.",
};

describe("the player check of the build the preview plays", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function setup() {
    const s = await versionsApp(PROJECT, cleanups);
    const read = async () => {
      const response = await s.client.get(`${s.endpoint}/player-check`);
      expect(response.status).toBe(200);
      return (await response.json()) as PlayerCheckResponse;
    };
    return { s, read };
  }

  it("answers nothing to show while there is no build", async () => {
    const { read } = await setup();
    expect(await read()).toEqual({ runId: null, report: null, gap: null });
  });

  it("reads the newest build's checks in the order they reported them", async () => {
    const { s, read } = await setup();
    await build(s, RUN_OLD, "2026-10-01T10:00:00.000Z", { results: { results: [PASSED] } });
    await build(s, RUN_NEW, "2026-10-02T10:00:00.000Z", {
      results: { results: [FAILED, PASSED] },
    });
    expect(await read()).toEqual({
      runId: RUN_NEW,
      gap: null,
      report: {
        overallStatus: "failed",
        checkedAt: "2026-10-02T10:17:00.000Z",
        results: [
          {
            criterion: "A wrong answer is told so",
            testName: "wrong answer",
            status: "failed",
            durationMs: 3400,
            error: "No feedback after 15 s.",
          },
          {
            criterion: "Every scene starts",
            testName: "scenes start",
            status: "passed",
            durationMs: 1200,
            error: null,
          },
        ],
      },
    });
  });

  it("says untrusted when the run changed what its checks rest on", async () => {
    const { s, read } = await setup();
    await build(s, RUN_NEW, "2026-10-02T10:00:00.000Z", {
      results: { results: [PASSED] },
      record: { playerCheck: { staged: {}, untrusted: true } },
    });
    expect((await read()).report).toMatchObject({ overallStatus: "passed", untrusted: true });
  });

  it("says why a build has no checks: no test browser, or a check that never ran", async () => {
    const first = await setup();
    await build(first.s, RUN_NEW, "2026-10-02T10:00:00.000Z", {
      staged: false,
      record: { unchecked: "noBrowser" },
    });
    expect(await first.read()).toEqual({ runId: RUN_NEW, report: null, gap: "noBrowser" });

    // An older record without the reason is told by what its workspace holds.
    const second = await setup();
    await build(second.s, RUN_OLD, "2026-10-01T10:00:00.000Z");
    expect(await second.read()).toEqual({ runId: RUN_OLD, report: null, gap: "notRun" });
    await build(second.s, RUN_NEW, "2026-10-02T10:00:00.000Z", { staged: false });
    expect(await second.read()).toEqual({ runId: RUN_NEW, report: null, gap: "noBrowser" });
  });

  it("treats a results file it cannot read as a check that never finished", async () => {
    const { s, read } = await setup();
    await build(s, RUN_NEW, "2026-10-02T10:00:00.000Z", { results: "{ not json" });
    expect(await read()).toEqual({ runId: RUN_NEW, report: null, gap: "notRun" });
  });
});

describe("a player check's report", () => {
  it("is skipped when no scenario was checked, and keeps a failure's words only", () => {
    expect(
      playerCheckReport([], { checkedAt: "2026-10-02T10:17:00.000Z", untrusted: false }),
    ).toEqual({ overallStatus: "skipped", results: [], checkedAt: "2026-10-02T10:17:00.000Z" });
    const report = playerCheckReport(
      [
        { ...PASSED, status: "passed", error: "left over" },
        { ...FAILED, status: "failed" },
      ],
      { checkedAt: "2026-10-02T10:17:00.000Z", untrusted: false },
    );
    expect(report.results.map((result) => result.error)).toEqual([null, "No feedback after 15 s."]);
  });
});
