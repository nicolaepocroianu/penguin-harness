/**
 * The QA deploy's words in the Deploy section: every new stage, failure and check finding the
 * server can send says something, the run line says QA for a QA run, the link to QA comes
 * from the stored stages, the stages that push ask first, and waiting comes first once a started
 * build's wait did not finish.
 */
import { describe, expect, it } from "vitest";
import type {
  DeployPreflightIssue,
  DeployRun,
  DeployStage,
  DeployStageError,
  DeployStageState,
} from "@prismshadow/penguin-server/api";
import {
  QA_STAGES,
  isQaRun,
  preflightFindings,
  preflightText,
  qaResult,
  qaWait,
  refusalText,
  runLine,
  stageConfirmText,
  stageErrorText,
  stageName,
} from "../src/features/activities/deploy-model";
import { DEPLOY_GROUPS, deployUpdate, formFromView } from "../src/features/settings/deploy-form";

const state = (
  stage: DeployStage,
  status: DeployStageState["status"],
  metadata: DeployStageState["metadata"] = {},
): DeployStageState => ({ stage, status, finishedAt: null, metadata, blocker: null });

function run(overrides: Partial<DeployRun> = {}): DeployRun {
  return {
    runId: "dep_1",
    activityId: "act_1",
    target: "qa",
    selection: "qa",
    status: "running",
    stages: [{ stage: "export_activity_data", status: "running", error: null }],
    metadata: {},
    startedAt: "2026-09-28T00:00:00.000Z",
    finishedAt: null,
    ...overrides,
  };
}

describe("the QA deploy's words", () => {
  it("names every QA stage", () => {
    for (const stage of QA_STAGES) expect(stageName(stage)).toMatch(/\w/);
    expect(stageName("verify_media_assets")).toBe("Publish the media");
  });

  it("says each new failure", () => {
    const errors: DeployStageError[] = [
      { code: "preflight_failed", errors: 2 },
      { code: "media_missing", paths: ["media/a.mp3", "media/b.png"], count: 3 },
      { code: "deploy_timed_out", minutes: 30 },
      { code: "media_optimise_failed", paths: ["loom/a.mp3"], count: 1 },
      { code: "media_lfs_pointer", paths: ["loom/a.mp3", "loom/b.mp4"], count: 2 },
      { code: "media_changed", paths: ["loom/a.mp3"], count: 1 },
      {
        code: "media_write_failed",
        paths: ["loom/a.mp3"],
        count: 1,
        error: "EBUSY: resource busy or locked, rename 'x' -> 'y'",
      },
    ];
    expect(errors.map(stageErrorText)).toEqual([
      "The activity data failed its check: 2 problems. The activity data and media were not pushed.",
      "3 media files are neither in the draft nor in the media repository: media/a.mp3, media/b.png, …. The activity data and media were not pushed.",
      "The QA deploy had not finished within 30 minutes.",
      "FFmpeg could not re-encode 1 media file: loom/a.mp3. Each was left as it was, and the activity data and media were not pushed. The log shows why.",
      "The media clone has only the Git LFS pointers, not the files, for 2 media files: loom/a.mp3, loom/b.mp4. They could not be checked or re-encoded, and the activity data and media were not pushed. Get the files into the media clone, then deploy again.",
      "1 media file changed in the media clone while it was re-encoded, and was left as it is now: loom/a.mp3. The activity data and media were not pushed. Deploy again.",
      "The re-encoded copy of loom/a.mp3 could not be put in the media clone: EBUSY: resource busy or locked, rename 'x' -> 'y'. The original is as before, and the activity data and media were not pushed.",
    ]);
  });

  it("says every finding of the check", () => {
    const file = "data/configurations/loom/words-1.json";
    const issues: DeployPreflightIssue[] = [
      { code: "deploy_list_mismatch", file: "deployLists/loom-words.txt" },
      { code: "file_missing", file },
      { code: "file_invalid", file },
      { code: "layout_module_mismatch", expected: "words@^1.5.0", found: null },
      { code: "no_sources" },
      { code: "assessment_empty", file },
      { code: "assessment_count_mismatch", file, items: 1, maxItems: 3 },
      { code: "media_path_unsafe", file, reference: "/media/../x" },
      { code: "media_preview_url", file, reference: "/sandbox/media/x" },
      { code: "media_token_left", file, reference: "{{MEDIA}}/x" },
      { code: "configuration_without_media", file },
    ];
    const texts = issues.map(preflightText);
    for (const text of texts) expect(text.length).toBeGreaterThan(5);
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts[6]).toBe(`${file} has 1 item but says it has 3.`);
  });

  it("says QA in the run line of a QA run, and release for a release", () => {
    expect(isQaRun(run())).toBe(true);
    expect(isQaRun(run({ selection: "publish_activity_data" }))).toBe(true);
    expect(isQaRun(run({ selection: "release" }))).toBe(false);
    expect(runLine(run())?.text).toBe("Deploying to QA: Export the activity data.");
    expect(runLine(run({ status: "succeeded" }))?.text).toBe("The last QA deploy finished.");
    expect(runLine(run({ selection: "release", status: "failed" }))?.text).toBe(
      "The last release failed.",
    );
  });

  it("links to QA only once the deploy is done, with the module version it went with", () => {
    const url = "https://qa.example.org/play?productCode=words&refNum=1&frameworkVersion=4.2.1";
    expect(qaResult([state("await_activity_deploy", "pending")])).toBeNull();
    expect(
      qaResult([
        state("export_activity_data", "done", { resolvedModuleVersion: "1.5.0" }),
        state("await_activity_deploy", "done", { qaActivityUrl: url }),
      ]),
    ).toEqual({ url, version: "1.5.0" });
  });

  it("lists the check's findings from the run, else the stored stage", () => {
    const report = {
      errors: [{ code: "no_sources" as const }],
      warnings: [],
      counts: { templates: 1, configurations: 0, assessments: 0, media: 0 },
    };
    expect(preflightFindings(run({ metadata: { preflight: report } }), [])).toEqual({
      errors: ["The template has no ref to deploy."],
      warnings: [],
    });
    expect(
      preflightFindings(null, [state("verify_activity_data", "failed", { preflight: report })])
        ?.errors,
    ).toHaveLength(1);
    expect(preflightFindings(null, [])).toBeNull();
  });

  it("asks before a stage that pushes or starts a Jenkins job, and not before one that only works here", () => {
    const branches = { deploy: "loom/words-deploy", activityData: "loom/words-activity-data" };
    expect(stageConfirmText("publish_activity_data", branches)).toBe(
      "This pushes the exported activity data to the branch loom/words-activity-data.",
    );
    expect(stageConfirmText("trigger_module_build", branches)).toContain("loom/words-deploy");
    expect(stageConfirmText("verify_media_assets", branches)).not.toBeNull();
    expect(stageConfirmText("trigger_activity_deploy", branches)).not.toBeNull();
    for (const stage of [
      "export_activity_data",
      "verify_activity_data",
      "await_activity_deploy",
    ] as const)
      expect(stageConfirmText(stage, branches)).toBeNull();
  });

  it("offers waiting first once the module build or the QA deploy was started and its wait did not finish", () => {
    const done = (stage: DeployStage) => state(stage, "done");
    const stopped = (stage: DeployStage, error?: DeployStageError): DeployStageState => ({
      ...state(stage, error ? "failed" : "cancelled"),
      ...(error ? { error } : {}),
    });
    const release = ["verify_module", "prepare_deploy", "trigger_module_build"] as const;
    const module = (wait: DeployStageState) => [...release.map(done), wait];
    const timedOut = { code: "build_timed_out", minutes: 30 } as const;
    // Timed out, stopped, or cut short by a restart: the build may still be going in Jenkins.
    for (const wait of [
      stopped("await_module_build", timedOut),
      stopped("await_module_build"),
      stopped("await_module_build", { code: "interrupted" }),
    ])
      expect(qaWait(module(wait), null)).toEqual({ stage: "await_module_build", blocker: null });
    const qa = [
      ...[...release, ...QA_STAGES.slice(0, -1)].map(done),
      done("await_module_build"),
      stopped("await_activity_deploy", { code: "deploy_timed_out", minutes: 30 }),
    ];
    expect(qaWait(qa, run({ status: "failed" }))?.stage).toBe("await_activity_deploy");
    // How it ended is the stored stage's, whichever run is in hand.
    expect(qaWait(qa, run({ target: "prod", selection: "prod", status: "failed" }))?.stage).toBe(
      "await_activity_deploy",
    );
    // The build had finished: waiting again finds the same, so deploying is offered.
    for (const error of [
      { code: "build_failed", result: "FAILURE", url: null },
      { code: "no_newer_tag", before: "1.2.0", after: "1.2.0" },
      { code: "tag_without_commit", tag: "1.3.0", commit: "c1" },
    ] as const)
      expect(qaWait(module(stopped("await_module_build", error)), null)).toBeNull();
    // A stage stored before its error was: the run that waited says.
    const unrecorded = module(stopped("await_module_build"));
    unrecorded[3] = state("await_module_build", "failed");
    const failedRun = run({
      selection: "release",
      status: "failed",
      stages: [
        { stage: "trigger_module_build", status: "done", error: null },
        {
          stage: "await_module_build",
          status: "failed",
          error: { code: "build_failed", result: "FAILURE", url: null },
        },
      ],
    });
    expect(qaWait(unrecorded, failedRun)).toBeNull();
    expect(qaWait(unrecorded, null)?.stage).toBe("await_module_build");
    // Why the wait cannot run now, said in the stage list's words.
    const blocked = module({
      ...stopped("await_module_build", timedOut),
      blocker: { code: "settings_missing", field: "qa.token" },
    });
    expect(qaWait(blocked, null)?.blocker).toBe("QA Jenkins token is empty.");
    // Nothing started, a wait that finished, or a run still going: Deploy to QA stays first.
    expect(qaWait([], null)).toBeNull();
    expect(qaWait(module(done("await_module_build")), null)).toBeNull();
    expect(qaWait(module(stopped("await_module_build", timedOut)), run())).toBeNull();
  });

  it("words a refusal that names a QA stage", () => {
    expect(
      refusalText({
        stage: "publish_activity_data",
        blocker: "previous_stage",
        previous: "verify_media_assets",
      }),
    ).toBe("Waits for Publish the media to finish.");
  });

  it("offers the media address in the deploy settings and sends it when changed", () => {
    const repos = DEPLOY_GROUPS.find((group) => group.key === "repos")!;
    expect(repos.fields.map((field) => field.path)).toContain("repos.mediaPublicBase");
    const view = {
      qa: {
        jenkinsUrl: "",
        username: "",
        token: { set: false },
        tier: "qa",
        environment: "loom",
        frameworkVersion: "",
        activityBaseUrl: "",
      },
      prod: {
        jenkinsUrl: "",
        username: "",
        token: { set: false },
        tier: "prod",
        environment: "DEFAULT",
        frameworkVersion: "",
      },
      jobs: { moduleBuild: "Build WAF Modules", activityDeploy: "WAF Activity Deploy" },
      repos: { activityDataRemote: "", mediaRemote: "", mediaPublicBase: "/media/" },
      git: { userName: "", userEmail: "" },
      timeouts: { buildMinutes: 30, deployMinutes: 30 },
    };
    const values = { ...formFromView(view), "repos.mediaPublicBase": "{{MEDIA}}/" };
    expect(
      deployUpdate(values, view, {
        qa: { value: "", forget: false },
        prod: { value: "", forget: false },
      }),
    ).toEqual({ repos: { mediaPublicBase: "{{MEDIA}}/" } });
  });
});
