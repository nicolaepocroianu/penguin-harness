/**
 * The PROD deploy's words in the Deploy section: its stages and failures say something, the
 * gate says why PROD waits, the bar shows the last deploy and the live PROD run, waiting comes
 * first once a started deploy's wait did not finish, and the typed confirmation matches only the
 * product code.
 */
import { describe, expect, it } from "vitest";
import type {
  DeployProductionState,
  DeployRun,
  DeployStage,
  DeployStageError,
  DeployStageState,
} from "@waterford/waf-harness-server/api";
import {
  PROD_STAGES,
  blockerText,
  isProdRun,
  markBlocked,
  pointToReadiness,
  prodBar,
  prodConfirmed,
  prodRefusalText,
  prodWaitFirst,
  refusalText,
  runLine,
  stageErrorText,
  stageName,
  stageRows,
} from "../src/features/activities/deploy-model";

const state = (
  stage: DeployStage,
  status: DeployStageState["status"] = "pending",
): DeployStageState => ({ stage, status, finishedAt: null, metadata: {}, blocker: null });

function production(overrides: Partial<DeployProductionState> = {}): DeployProductionState {
  return {
    stages: [state("trigger_production_deploy"), state("await_production_deploy")],
    blocker: null,
    last: null,
    ...overrides,
  };
}

function run(overrides: Partial<DeployRun> = {}): DeployRun {
  return {
    runId: "dep_1",
    activityId: "act_1",
    target: "prod",
    selection: "prod",
    status: "running",
    stages: [
      { stage: "trigger_production_deploy", status: "done", error: null },
      { stage: "await_production_deploy", status: "running", error: null },
    ],
    metadata: {},
    startedAt: "2026-09-28T00:00:00.000Z",
    finishedAt: null,
    ...overrides,
  };
}

const when = (iso: string) => `at ${iso}`;

describe("the PROD deploy's words", () => {
  it("names both PROD stages", () => {
    expect(PROD_STAGES.map(stageName)).toEqual([
      "Start the PROD deploy",
      "Wait for the PROD deploy",
    ]);
  });

  it("says why PROD waits for QA, from the stage list and from a refusal", () => {
    expect(blockerText({ code: "qa_outdated" })).toBe(
      "The activity changed after it went to QA. Deploy to QA again first.",
    );
    expect(refusalText({ stage: "trigger_production_deploy", blocker: "qa_outdated" })).toBe(
      blockerText({ code: "qa_outdated" }),
    );
    expect(
      refusalText({
        stage: "trigger_production_deploy",
        blocker: "previous_stage",
        previous: "await_activity_deploy",
      }),
    ).toBe("Waits for Wait for the QA deploy to finish.");
  });

  it("names PROD in a PROD timeout, and QA in one that names no target", () => {
    expect(stageErrorText({ code: "deploy_timed_out", minutes: 30, target: "prod" })).toMatch(
      /^The PROD deploy/,
    );
    expect(stageErrorText({ code: "deploy_timed_out", minutes: 1 })).toBe(
      "The QA deploy had not finished within 1 minute.",
    );
  });

  it("words a PROD run as PROD", () => {
    expect(isProdRun(run())).toBe(true);
    expect(runLine(run())?.text).toBe("Deploying to PROD: Wait for the PROD deploy.");
    expect(runLine(run({ status: "succeeded" }))).toEqual({
      tone: "success",
      text: "The last PROD deploy finished.",
    });
    expect(isProdRun(run({ target: "qa", selection: "qa" }))).toBe(false);
  });

  it("shows no deploy yet, the gate, and the last deploy with its framework", () => {
    const empty = prodBar(production({ blocker: { code: "qa_outdated" } }), null, when);
    expect(empty.last).toBe("Not deployed to PROD yet.");
    expect(empty.blocker).toBe(blockerText({ code: "qa_outdated" }));
    expect(empty.line).toBeNull();
    expect(empty.rows.map((row) => row.statusText)).toEqual(["Not run", "Not run"]);

    const done = prodBar(
      production({
        stages: [
          state("trigger_production_deploy", "done"),
          state("await_production_deploy", "done"),
        ],
        last: {
          runId: "dep_1",
          deployedAt: "2026-09-28T09:00:00.000Z",
          contentRevision: "rev",
          frameworkVersion: "4.1.0",
          url: "https://jenkins/job/9/",
        },
      }),
      run({ target: "qa", selection: "qa", status: "succeeded", stages: [] }),
      when,
    );
    expect(done.last).toBe(
      "Last deployed to PROD on at 2026-09-28T09:00:00.000Z, with framework 4.1.0.",
    );
    expect(done.lastUrl).toBe("https://jenkins/job/9/");
    expect(done.blocker).toBeNull();
    // The latest run is QA's: the bar has no line of its own.
    expect(done.line).toBeNull();
  });

  it("follows a live PROD run, and waits while any run goes", () => {
    const live = prodBar(production(), run(), when);
    expect(live.rows.map((row) => row.status)).toEqual(["done", "running"]);
    expect(live.line?.tone).toBe("busy");
    expect(live.blocker).toBe("A deploy is running on this server.");

    const qa = prodBar(
      production(),
      run({
        target: "qa",
        selection: "qa",
        stages: [{ stage: "export_activity_data", status: "running", error: null }],
      }),
      when,
    );
    expect(qa.line).toBeNull();
    expect(qa.blocker).toBe("A deploy is running on this server.");
  });

  it("offers waiting first once the PROD deploy was started and the wait for it did not finish", () => {
    const started = (
      wait: DeployStageState["status"],
      blocker: DeployStageState["blocker"] = null,
    ) =>
      production({
        stages: [
          state("trigger_production_deploy", "done"),
          { ...state("await_production_deploy", wait), blocker },
        ],
      });
    const ended = (error: DeployStageError, status: DeployRun["status"] = "failed") =>
      run({
        status,
        stages: [
          { stage: "trigger_production_deploy", status: "done", error: null },
          { stage: "await_production_deploy", status: "failed", error },
        ],
      });
    // Timed out, cut short by a restart, or stopped: the deploy may still be going in Jenkins.
    const timedOut = ended({ code: "deploy_timed_out", minutes: 30, target: "prod" });
    expect(prodWaitFirst(started("failed"), timedOut)).toBe(true);
    expect(prodWaitFirst(started("failed"), ended({ code: "interrupted" }, "interrupted"))).toBe(
      true,
    );
    expect(prodWaitFirst(started("cancelled"), run({ status: "cancelled" }))).toBe(true);
    expect(prodBar(started("failed"), timedOut, when).wait).toEqual({ blocker: null });
    const missing = { code: "settings_missing", field: "prod.token" } as const;
    expect(prodBar(started("failed", missing), null, when).wait).toEqual({
      blocker: blockerText(missing),
    });
    // Jenkins said the deploy failed: that one is started again.
    const failed = ended({ code: "build_failed", result: "FAILURE", url: null });
    expect(prodWaitFirst(started("failed"), failed)).toBe(false);
    // With no PROD run in hand, the stored wait says how it ended.
    const stored = (error: DeployStageError) =>
      production({
        stages: [
          state("trigger_production_deploy", "done"),
          { ...state("await_production_deploy", "failed"), error },
        ],
      });
    const buildFailed = { code: "build_failed", result: "FAILURE", url: null } as const;
    expect(prodWaitFirst(stored(buildFailed), null)).toBe(false);
    expect(prodWaitFirst(stored(buildFailed), run({ target: "qa", status: "failed" }))).toBe(false);
    expect(
      prodWaitFirst(stored({ code: "deploy_timed_out", minutes: 30, target: "prod" }), null),
    ).toBe(true);
    // Nothing started, a wait that finished, or a run still going: deploying stays first.
    expect(prodWaitFirst(production(), null)).toBe(false);
    expect(prodWaitFirst(started("done"), null)).toBe(false);
    expect(prodWaitFirst(started("running"), run())).toBe(false);
    expect(prodBar(production(), null, when).wait).toBeNull();
  });

  it("confirms only on the product code, exactly", () => {
    expect(prodConfirmed("words", "words")).toBe(true);
    expect(prodConfirmed("  words ", "words")).toBe(false);
    expect(prodConfirmed("Words", "words")).toBe(false);
    expect(prodConfirmed("", "words")).toBe(false);
    expect(prodRefusalText("confirmation_mismatch")).toMatch(/did not match/);
    expect(prodRefusalText("prod_requires_admin")).toMatch(/admin/);
    expect(prodRefusalText("deploy_blocked")).toBeNull();
  });
});

describe("a readiness problem, said once", () => {
  const noMain = {
    code: "branch_missing",
    repo: "module",
    branch: "main",
    where: "local",
  } as const;
  const blocked = (stage: DeployStage): DeployStageState => ({
    ...state(stage),
    blocker: { code: "not_ready", problem: noMain },
  });

  it("points a stage the strip explains there, rather than saying the problem again", () => {
    const stages = [blocked("verify_module"), blocked("prepare_deploy")];
    const rows = pointToReadiness(markBlocked(stageRows(null, stages)), stages, [noMain]);
    expect(rows.map((row) => [row.statusText, row.blocker])).toEqual([
      ["Blocked", "Waits for what is missing above."],
      ["Not run", "Waits for what is missing above."],
    ]);
    // A problem the strip does not list keeps its own words.
    const own = pointToReadiness(stageRows(null, stages), stages, []);
    expect(own[0]!.blocker).toBe(blockerText({ code: "not_ready", problem: noMain }));
  });

  it("has PROD point there too, but name a gate of its own", () => {
    const readiness = prodBar(
      production({ blocker: { code: "not_ready", problem: noMain } }),
      null,
      when,
      [noMain],
    );
    expect(readiness.blocker).toBe("Waits for what is missing above.");
    // A PROD setting the readiness checks do not cover is PROD's own to say.
    const setting = prodBar(
      production({ blocker: { code: "settings_missing", field: "prod.tier" } }),
      null,
      when,
      [noMain],
    );
    expect(setting.blocker).toBe(blockerText({ code: "settings_missing", field: "prod.tier" }));
  });
});
