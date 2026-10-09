/**
 * The Deploy page as one pipeline: each problem is offered only the press that really clears
 * it, a press shared by several problems is offered once, the stage the pipeline stopped at
 * reads Blocked, the stages fall into their three phases, and QA and PROD each say where the
 * activity stands in a word.
 */
import { describe, expect, it } from "vitest";
import type {
  DeployProblem,
  DeployProductionState,
  DeployRun,
  DeployStage,
  DeployStageState,
} from "@prismshadow/penguin-server/api";
import {
  QA_STAGES,
  RELEASE_STAGES,
  checksSummary,
  deployPhases,
  markBlocked,
  problemAction,
  prodStatus,
  qaStatus,
  readinessBlocksStart,
  readinessGroups,
  stageRows,
  type ReadinessRow,
} from "../src/features/activities/deploy-model";

const ALL = [...RELEASE_STAGES, ...QA_STAGES];

function stored(overrides: Partial<Record<DeployStage, Partial<DeployStageState>>> = {}) {
  return ALL.map((stage, index): DeployStageState => ({
    stage,
    status: "pending",
    finishedAt: null,
    metadata: {},
    blocker: index > 0 ? { code: "previous_stage", stage: ALL[index - 1]! } : null,
    ...overrides[stage],
  }));
}

function run(overrides: Partial<DeployRun> = {}): DeployRun {
  return {
    runId: "dep_1",
    activityId: "act_1",
    target: "qa",
    selection: "qa",
    status: "succeeded",
    startedAt: "2026-10-09T00:00:00.000Z",
    finishedAt: "2026-10-09T00:05:00.000Z",
    stages: [],
    metadata: {},
    ...overrides,
  } as DeployRun;
}

describe("the readiness strip", () => {
  it("offers only the press that clears each problem", () => {
    const cases: [DeployProblem, string | null][] = [
      [{ code: "clone_missing", repo: "module" }, "prepareClones"],
      [{ code: "clone_missing", repo: "media" }, "workspaceSettings"],
      [{ code: "clone_missing", repo: "activityData" }, "workspaceSettings"],
      [{ code: "media_path_missing", path: "words" }, "prepareClones"],
      [{ code: "remote_unreachable", repo: "module" }, "checkRemote"],
      [{ code: "settings_missing", field: "qa.jenkinsUrl" }, "deploySettings"],
      [{ code: "workspace_not_ready" }, "workspaceSettings"],
      // Asking the remote again only reports a missing branch, and preparing an existing clone
      // does not fetch one, so neither is offered.
      [{ code: "branch_missing", repo: "module", branch: "main", where: "local" }, null],
      [{ code: "branch_missing", repo: "module", branch: "main", where: "remote" }, null],
      [{ code: "clone_dirty", repo: "activityData" }, null],
      [{ code: "git_unavailable" }, null],
      [{ code: "not_canonical" }, null],
    ];
    for (const [problem, action] of cases) expect(problemAction(problem)).toBe(action);
  });

  it("keeps the problems one press clears together, in the server's order", () => {
    const groups = readinessGroups([
      { code: "settings_missing", field: "qa.jenkinsUrl" },
      { code: "clone_missing", repo: "module" },
      { code: "git_unavailable" },
      { code: "clone_missing", repo: "media" },
      { code: "media_path_missing", path: "words" },
      { code: "not_canonical" },
    ]);
    expect(groups.map((group) => [group.action, group.texts.length])).toEqual([
      ["deploySettings", 1],
      ["prepareClones", 2],
      [null, 1],
      ["workspaceSettings", 1],
      [null, 1],
    ]);
    expect(groups[1]!.texts[1]).toBe(
      "The Media clone does not check out words yet. Prepare clones adds it.",
    );
    expect(readinessGroups([])).toEqual([]);
  });

  it("sums up the folded checks from their tones", () => {
    const row = (tone: ReadinessRow["tone"]): ReadinessRow => ({
      id: tone,
      label: tone,
      tone,
      state: "",
    });
    expect(checksSummary([row("success"), row("muted"), row("danger")])).toBe(
      "3 checks, 1 needs attention",
    );
    expect(checksSummary([row("attention"), row("danger")])).toBe("2 checks, 2 need attention");
    expect(checksSummary([row("success")])).toBe("1 check, none needs attention");
  });
});

describe("the pipeline", () => {
  it("marks the stage the pipeline stopped at as Blocked, and only that one", () => {
    const rows = markBlocked(
      stageRows(
        null,
        stored({
          verify_module: { blocker: { code: "not_ready", problem: { code: "git_unavailable" } } },
        }),
      ),
    );
    expect(rows[0]!.statusText).toBe("Blocked");
    expect(rows[0]!.tone).toBe("attention");
    expect(rows.slice(1).every((row) => row.statusText === "Not run")).toBe(true);
  });

  it("keeps a stopped stage Stopped, even when it cannot run again yet", () => {
    const stopped = stored({
      verify_module: { status: "done", blocker: null },
      prepare_deploy: {
        status: "cancelled",
        blocker: { code: "previous_rerun", stage: "verify_module" },
      },
    });
    const rows = markBlocked(stageRows(null, stopped));
    expect(rows[1]!.statusText).toBe("Stopped");
    expect(rows.map((row) => row.statusText)).not.toContain("Blocked");
  });

  it("marks nothing when the next stage can run, while a run goes, or after a failure", () => {
    expect(markBlocked(stageRows(null, stored())).map((row) => row.statusText)).not.toContain(
      "Blocked",
    );
    const failed = stored({
      verify_module: { status: "failed", blocker: { code: "run_active" } },
    });
    expect(markBlocked(stageRows(null, failed))[0]!.statusText).toBe("Failed");
    const live = run({
      status: "running",
      finishedAt: null,
      stages: ALL.map((stage, index) => ({
        stage,
        status: index === 0 ? "running" : "pending",
        error: null,
      })),
    });
    expect(markBlocked(stageRows(live, stored())).map((row) => row.statusText)).not.toContain(
      "Blocked",
    );
  });

  it("puts the stages in their three phases with how many are done", () => {
    const rows = stageRows(
      null,
      stored({
        verify_module: { status: "done" },
        prepare_deploy: { status: "done" },
        verify_media_assets: { metadata: { mediaChecked: 35 } },
      }),
    );
    const phases = deployPhases(rows);
    expect(phases.map((phase) => [phase.key, phase.rows.length, phase.done])).toEqual([
      ["module", 4, 2],
      ["data", 4, 0],
      ["qa", 2, 0],
    ]);
    // The media count shows only once the media stage recorded it.
    expect(phases[1]!.rows.map((row) => row.detail)).toEqual([null, null, "35 media files", null]);
    expect(stageRows(null, stored()).every((row) => row.detail === null)).toBe(true);
  });
});

describe("what keeps Deploy to QA waiting", () => {
  it("is the stages' readiness blockers, not every problem the checks list", () => {
    // A dirty activity-data clone (an export that failed half way) is listed but tolerated:
    // the server leaves the stages unblocked, so a retry may start.
    expect(readinessBlocksStart(stored())).toBe(false);
    expect(
      readinessBlocksStart(
        stored({
          verify_module: { blocker: { code: "settings_missing", field: "qa.jenkinsUrl" } },
        }),
      ),
    ).toBe(true);
    expect(
      readinessBlocksStart(
        stored({
          verify_module: { blocker: { code: "not_ready", problem: { code: "git_unavailable" } } },
        }),
      ),
    ).toBe(true);
    expect(
      readinessBlocksStart(stored({ verify_module: { blocker: { code: "run_active" } } })),
    ).toBe(false);
  });
});

describe("the QA and PROD cards", () => {
  const onQa = stored({
    await_activity_deploy: {
      status: "done",
      metadata: { qaActivityUrl: "https://qa.example.org/play" },
    },
  });

  it("says where the activity stands on QA", () => {
    expect(qaStatus(null, stored())).toEqual({ tone: "muted", text: "Not deployed" });
    expect(qaStatus(null, onQa)).toEqual({ tone: "success", text: "On QA" });
    expect(qaStatus(run({ status: "running", finishedAt: null }), onQa)).toEqual({
      tone: "busy",
      text: "Deploying",
    });
    expect(qaStatus(run({ status: "failed" }), stored())).toEqual({
      tone: "danger",
      text: "Last deploy failed",
    });
    // A release on its own is not a QA deploy.
    expect(qaStatus(run({ selection: "release", status: "failed" }), stored()).text).toBe(
      "Not deployed",
    );
  });

  it("says where the activity stands on PROD", () => {
    const never: DeployProductionState = { stages: [], blocker: null, last: null };
    const once: DeployProductionState = {
      ...never,
      last: {
        runId: "dep_p",
        deployedAt: "2026-10-09T00:00:00.000Z",
        contentRevision: null,
        frameworkVersion: null,
        url: null,
      },
    };
    const prod = (status: DeployRun["status"]) =>
      run({ target: "prod", selection: "prod", status });
    expect(prodStatus(never, null).text).toBe("Not deployed");
    expect(prodStatus(once, null).text).toBe("On PROD");
    expect(prodStatus(never, prod("running")).text).toBe("Deploying");
    expect(prodStatus(once, prod("failed")).text).toBe("Last deploy failed");
    // A QA run says nothing about PROD.
    expect(prodStatus(once, run({ status: "failed" })).text).toBe("On PROD");
  });
});
