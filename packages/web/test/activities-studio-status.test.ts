import { describe, expect, it } from "vitest";
import {
  nextAction,
  nextStep,
  progressSteps,
  qaFact,
  type ProgressFacts,
} from "../src/features/activities/studio-status";

const facts: ProgressFacts = {
  status: "valid",
  scriptDirty: false,
  specDirty: false,
  media: { bound: 3, total: 3 },
  hasModule: true,
  qa: "deployed",
};

describe("the header's next step", () => {
  it("has nothing to offer once every step is done", () => {
    expect(nextStep(progressSteps(facts))).toBeNull();
  });

  it("offers the first unfinished step, with where to do it", () => {
    const next = (patch: Partial<ProgressFacts>) => nextStep(progressSteps({ ...facts, ...patch }));
    expect(next({ scriptDirty: true })?.todo).toEqual({
      action: "save the script",
      go: { kind: "section", section: "description" },
    });
    expect(next({ status: "draft" })).toMatchObject({
      state: "draft, not validated",
      tone: "attention",
      todo: { action: "validate the spec", go: { kind: "section", section: "specification" } },
    });
    expect(next({ status: "invalid" })?.todo?.action).toBe("fix the spec");
    expect(next({ specDirty: true })?.todo?.action).toBe("save the spec");
    expect(next({ media: null })?.todo?.action).toBe("plan the media");
    expect(next({ media: { bound: 1, total: 3 } })?.todo?.action).toBe("finish the media");
    // The module is built by running the stages, which the Stages panel follows.
    expect(next({ hasModule: false })?.todo).toEqual({
      action: "build the module",
      go: { kind: "panel", panel: "run" },
    });
    expect(next({ qa: "none" })?.todo?.action).toBe("deploy to QA");
    expect(next({ qa: "failed" })).toMatchObject({
      tone: "danger",
      todo: { action: "deploy to QA" },
    });
  });

  it("offers nothing for a QA deploy that is running or whose state is not yet read", () => {
    expect(nextStep(progressSteps({ ...facts, qa: "deploying" }))).toBeNull();
    expect(nextStep(progressSteps({ ...facts, qa: null }))).toBeNull();
  });

  it("takes the earlier step first", () => {
    const steps = progressSteps({ ...facts, scriptDirty: true, status: "draft", qa: "none" });
    expect(nextStep(steps)?.section).toBe("description");
  });

  it("offers the action only to someone who can act, while the step still stands out", () => {
    const steps = progressSteps({ ...facts, hasModule: false });
    expect(nextAction(steps, true)?.action).toBe("build the module");
    expect(nextAction(steps, false)).toBeNull();
    expect(nextStep(steps)?.section).toBe("module");
  });
});

describe("the QA step from the deploy state", () => {
  const stage = (stage: string, status: string, metadata: Record<string, string> = {}) =>
    ({ stage, status, finishedAt: null, metadata, blocker: null }) as never;
  const run = (selection: string, status: string, target = "qa") =>
    ({ runId: "r", activityId: "a", target, selection, status, stages: [], metadata: {} }) as never;

  it("reads a finished deploy off the stored stages, so it survives a reload", () => {
    expect(
      qaFact({
        run: null,
        stages: [stage("await_activity_deploy", "done", { qaActivityUrl: "https://qa/x" })],
      }),
    ).toBe("deployed");
    expect(qaFact({ run: null, stages: [stage("await_activity_deploy", "pending")] })).toBe("none");
  });

  it("says a QA deploy is running, and that the last one failed", () => {
    expect(qaFact({ run: run("qa", "running"), stages: [] })).toBe("deploying");
    expect(qaFact({ run: run("qa", "failed"), stages: [] })).toBe("failed");
    // A release on its own, or a PROD run, says nothing about QA.
    expect(qaFact({ run: run("release", "running"), stages: [] })).toBe("none");
    expect(qaFact({ run: run("qa", "running", "prod"), stages: [] })).toBe("none");
  });
});
