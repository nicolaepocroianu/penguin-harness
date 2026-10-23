import { describe, expect, it } from "vitest";
import type { DeployProblem } from "@waterford/waf-harness-server/api";
import type { ChecksFacts } from "../src/features/activities/checks-model";
import {
  deployFacts,
  journeySteps,
  moduleFacts,
  nextStep,
  qaFact,
  readinessItems,
  stepOf,
  type DeployFacts,
  type JourneyFacts,
} from "../src/features/activities/journey-model";

const passing: ChecksFacts = {
  running: false,
  criteria: 3,
  tests: { passed: 3, failed: 0, stale: false },
  quality: { findings: 0, failed: false },
  player: { passed: 6, failed: 0, untrusted: false },
  playerGap: null,
};
const clear: DeployFacts = { qa: "none", blocking: [], qaBehind: false };
/** An activity with nothing left to do before QA. */
const facts: JourneyFacts = {
  status: "valid",
  hasSpec: true,
  scriptDirty: false,
  specDirty: false,
  media: { bound: 38, total: 38 },
  module: { built: true, builtAt: "2026-10-12T18:07:00Z", outdated: false, building: false },
  checks: passing,
  deploy: clear,
};
const when = (iso: string) => `day of ${iso.slice(0, 10)}`;
const noMain: DeployProblem = {
  code: "branch_missing",
  repo: "module",
  branch: "main",
  where: "local",
};

describe("the journey's six steps", () => {
  it("says where each step stands, in words, a mark and a tone", () => {
    expect(
      journeySteps(facts, when).map(({ label, state, mark, tone }) => [label, state, mark, tone]),
    ).toEqual([
      ["Script", "Saved", "done", "success"],
      ["Specification", "Validated", "done", "success"],
      ["Media", "38 ready", "done", "success"],
      ["Module", "Built day of 2026-10-12", "done", "success"],
      ["Checks", "Passed", "done", "success"],
      ["Deploy", "Ready", "todo", "muted"],
    ]);
  });

  it("goes to each step's section, and Checks to its tool", () => {
    expect(journeySteps(facts, when).map((step) => step.go)).toEqual([
      { kind: "section", section: "description" },
      { kind: "section", section: "specification" },
      { kind: "section", section: "scenes" },
      { kind: "section", section: "module" },
      { kind: "tool", tool: "checks" },
      { kind: "section", section: "deploy" },
    ]);
  });

  it("marks a blocked deploy with a lock, and a failed one with a cross", () => {
    const deploy = (patch: Partial<DeployFacts>) =>
      journeySteps({ ...facts, deploy: { ...clear, ...patch } }, when)[5]!;
    expect(deploy({ blocking: [noMain] })).toMatchObject({
      state: "Blocked",
      mark: "blocked",
      tone: "attention",
    });
    expect(deploy({ qa: "failed" })).toMatchObject({
      state: "Deploy failed",
      mark: "failed",
      tone: "danger",
    });
    expect(deploy({ qa: "deploying" })).toMatchObject({ state: "Deploying", mark: "busy" });
    expect(deploy({ qa: "deployed" })).toMatchObject({ state: "On QA", mark: "done" });
    expect(deploy({ qa: "deployed", qaBehind: true })).toMatchObject({
      state: "QA is behind",
      mark: "attention",
    });
    expect(journeySteps({ ...facts, deploy: null }, when)[5]).toMatchObject({
      state: "Not checked",
      mark: "todo",
    });
    const unbuilt = { ...facts, module: { ...facts.module, built: false } };
    expect(journeySteps(unbuilt, when)[5]).toMatchObject({ state: "Needs a module" });
  });

  it("counts a placeholder apart from a real file, never as finished media", () => {
    const media = (patch: Partial<JourneyFacts>) => journeySteps({ ...facts, ...patch }, when)[2]!;
    expect(media({ media: { bound: 38, total: 38, placeholders: 8 } })).toMatchObject({
      state: "30 ready · 8 placeholders",
      mark: "attention",
      tone: "attention",
    });
    expect(media({ media: { bound: 36, total: 38, placeholders: 8 } }).state).toBe(
      "28 of 38 · 8 placeholders",
    );
    expect(media({ media: null })).toMatchObject({ state: "No plan yet", mark: "todo" });
    expect(media({ videosToCheck: 2 }).state).toBe("2 videos need a look");
  });

  it("says the script and specification's own states", () => {
    const steps = (patch: Partial<JourneyFacts>) => journeySteps({ ...facts, ...patch }, when);
    expect(steps({ scriptDirty: true })[0]).toMatchObject({ state: "Unsaved", mark: "attention" });
    expect(steps({ status: "draft" })[1]).toMatchObject({
      state: "Not validated",
      mark: "attention",
    });
    expect(steps({ status: "invalid" })[1]).toMatchObject({ state: "Invalid", mark: "failed" });
    expect(steps({ hasSpec: false, status: "draft" })[1]).toMatchObject({
      state: "Not written",
      mark: "todo",
    });
  });

  it("says a build older than the draft, and one building", () => {
    const module = (patch: Partial<JourneyFacts["module"]>) =>
      journeySteps({ ...facts, module: { ...facts.module, ...patch } }, when)[3]!;
    expect(module({ outdated: true })).toMatchObject({
      state: "Older than the draft",
      mark: "attention",
    });
    expect(module({ building: true })).toMatchObject({ state: "Building", mark: "busy" });
    expect(module({ built: false })).toMatchObject({ state: "Not built", mark: "todo" });
  });

  it("puts failures before findings, and says when the checks have not run", () => {
    const checks = (patch: Partial<ChecksFacts> | null) =>
      journeySteps({ ...facts, checks: patch && { ...passing, ...patch } }, when)[4]!;
    expect(checks({ tests: { passed: 1, failed: 2, stale: false } })).toMatchObject({
      state: "2 failing",
      mark: "failed",
    });
    expect(checks({ player: { passed: 5, failed: 1, untrusted: false } }).state).toBe("1 failing");
    expect(checks({ quality: { findings: 3, failed: false } })).toMatchObject({
      state: "3 findings",
      mark: "attention",
    });
    // A failure on an earlier specification does not count; it is out of date.
    expect(checks({ tests: { passed: 1, failed: 2, stale: true } }).state).toBe("Out of date");
    expect(checks({ tests: null, quality: null }).state).toBe("Not run");
    // Without criteria the tests cannot run, so nothing having run is still Not run.
    expect(checks({ criteria: 0, tests: null, quality: null }).state).toBe("Not run");
    expect(checks({ criteria: 0, tests: null }).state).toBe("Passed");
    expect(checks({ quality: null }).state).toBe("Partly run");
    expect(checks({ running: true })).toMatchObject({ state: "Running", mark: "busy" });
    expect(checks(null).state).toBe("Not read yet");
  });

  it("marks where the author is: the open section's step", () => {
    expect(stepOf("description")).toBe("script");
    expect(stepOf("features")).toBe("specification");
    expect(stepOf("library")).toBe("media");
    expect(stepOf("assessment")).toBe("module");
    expect(stepOf("deploy")).toBe("deploy");
    expect(stepOf("history")).toBeNull();
  });
});

describe("the readiness list and the next-step button", () => {
  it("offers QA only once the deploy has been read and holds nothing back", () => {
    expect(nextStep(facts, readinessItems(facts))).toMatchObject({
      state: "ready",
      label: "Ready for QA",
    });
    const unknown = { ...facts, deploy: null };
    expect(readinessItems(unknown)).toEqual([]);
    expect(nextStep(unknown, [])).toMatchObject({ state: "unknown", label: "Before QA" });
  });

  it("never points at QA while the deploy would refuse it: the module clone has no main branch", () => {
    const blocked = { ...facts, deploy: { ...clear, blocking: [noMain] } };
    const items = readinessItems(blocked);
    expect(items).toEqual([
      {
        id: "deploy:branch:module:local",
        kind: "blocker",
        title: "Create the main branch",
        detail: "The Module clone has no main branch.",
        fix: { label: "Fix in Deploy", go: { kind: "section", section: "deploy" } },
      },
    ]);
    expect(nextStep(blocked, items)).toMatchObject({
      state: "steps",
      label: "1 step to QA",
      blockers: 1,
      recommendations: 0,
    });
  });

  it("holds every combination of blocker to the same rule", () => {
    const deploys: (DeployFacts | null)[] = [
      null,
      clear,
      { ...clear, blocking: [noMain] },
      { ...clear, blocking: [{ code: "settings_missing", field: "qa.tier" }] },
      { ...clear, qa: "failed" },
    ];
    for (const deploy of deploys)
      for (const built of [true, false])
        for (const scriptDirty of [true, false]) {
          const case_ = { ...facts, deploy, scriptDirty, module: { ...facts.module, built } };
          const items = readinessItems(case_);
          const next = nextStep(case_, items);
          if (items.some((item) => item.kind === "blocker") || !deploy)
            expect(next.state, JSON.stringify(case_)).not.toBe("ready");
          // Blockers come first.
          const kinds = items.map((item) => item.kind);
          expect(kinds.join(",")).toBe([...kinds].sort().join(","));
        }
  });

  it("blocks on work a deploy left in a clone's stash, with its own fix", () => {
    const stash: DeployProblem = { code: "clone_stash_left", repo: "module" };
    const items = readinessItems({ ...facts, deploy: { ...clear, blocking: [stash] } });
    expect(items).toMatchObject([
      {
        id: "deploy:stash:module",
        kind: "blocker",
        title: "Put back or drop the work stashed in the Module clone",
        fix: { label: "Fix in Deploy", go: { kind: "section", section: "deploy" } },
      },
    ]);
    expect(items[0]!.detail).toMatch(/^The Module clone has work a deploy set aside/);
  });

  it("asks for a module before anything the deploy says", () => {
    const unbuilt = {
      ...facts,
      module: { ...facts.module, built: false },
      deploy: { ...clear, blocking: [noMain] },
    };
    expect(readinessItems(unbuilt)).toEqual([
      {
        id: "module",
        kind: "blocker",
        title: "Build the module",
        detail: "A deploy ships the assembled module, and there is none yet.",
        fix: { label: "Open Stages", go: { kind: "tool", tool: "run" } },
      },
    ]);
  });

  it("lists one fix once for every problem it clears, in the server's order", () => {
    const deploy: DeployFacts = {
      ...clear,
      blocking: [
        { code: "settings_missing", field: "qa.jenkinsUrl" },
        { code: "clone_missing", repo: "module" },
        { code: "settings_missing", field: "qa.tier" },
        { code: "media_path_missing", path: "media/loom/words" },
      ],
    };
    const items = readinessItems({ ...facts, deploy });
    expect(items.map((item) => [item.title, item.detail])).toEqual([
      ["Fill in the deploy settings", "QA Jenkins address is empty. QA tier is empty."],
      [
        "Prepare the clones",
        "The Module clone is not on this server yet. Prepare clones makes the module's; an admin prepares the others in Settings, under WAF workspace. The Media clone does not check out media/loom/words yet. Prepare clones adds it.",
      ],
    ]);
  });

  it("recommends what is worth doing first, after the blockers, each where it is done", () => {
    const busy: JourneyFacts = {
      ...facts,
      scriptDirty: true,
      status: "draft",
      media: { bound: 36, total: 38, placeholders: 8 },
      videosToCheck: 1,
      module: { ...facts.module, outdated: true },
      checks: { ...passing, criteria: 0, tests: null, quality: null, playerGap: "noBrowser" },
      deploy: { ...clear, qa: "failed" },
    };
    const items = readinessItems(busy);
    expect(items.every((item) => item.kind === "recommendation")).toBe(true);
    expect(items.map((item) => [item.id, item.title, item.fix.go])).toEqual([
      ["saveScript", "Save the script", { kind: "section", section: "description" }],
      ["spec", "Validate the specification", { kind: "section", section: "specification" }],
      ["bindMedia", "Give every clip a file", { kind: "section", section: "scenes" }],
      ["videos", "Look at the scene videos", { kind: "section", section: "scenes" }],
      ["placeholders", "Replace 8 placeholders", { kind: "section", section: "scenes" }],
      ["rebuild", "Assemble the module again", { kind: "section", section: "module" }],
      ["criteria", "Add acceptance criteria", { kind: "section", section: "specification" }],
      ["runChecks", "Run the checks", { kind: "tool", tool: "checks" }],
      ["playerCheck", "Check the build in the player", { kind: "tool", tool: "checks" }],
      ["qaFailed", "See why the QA deploy failed", { kind: "section", section: "deploy" }],
    ]);
    expect(items.find((item) => item.id === "placeholders")?.detail).toBe(
      "8 clips use the shared stand-in clip, which learners would see.",
    );
    expect(items.find((item) => item.id === "runChecks")?.detail).toBe(
      "The quality checks have not run.",
    );
    expect(nextStep(busy, items)).toMatchObject({ label: "10 steps to QA", short: "10 to QA" });
  });

  it("says what the checks found, and which of them have not run", () => {
    const found = readinessItems({
      ...facts,
      checks: {
        ...passing,
        tests: { passed: 1, failed: 2, stale: false },
        quality: { findings: 1, failed: false },
        player: { passed: 5, failed: 1, untrusted: false },
      },
    });
    expect(found.map((item) => [item.title, item.detail])).toEqual([
      [
        "Fix what the checks found",
        "2 criteria fail · 1 quality finding · 1 player scenario fails",
      ],
    ]);
    const due = (checks: Partial<ChecksFacts>) =>
      readinessItems({ ...facts, checks: { ...passing, ...checks } })[0]?.detail;
    expect(due({ tests: null, quality: null })).toBe(
      "Neither the tests nor the quality checks have run.",
    );
    expect(due({ tests: null })).toBe("The tests have not run.");
    expect(due({ tests: { passed: 3, failed: 1, stale: true } })).toBe(
      "The tests ran on an earlier specification.",
    );
    // A run in progress says nothing until it ends.
    expect(
      readinessItems({ ...facts, checks: { ...passing, running: true, tests: null } }),
    ).toEqual([]);
  });

  it("says a QA deploy running, QA as it is now, and QA behind the activity", () => {
    const at = (deploy: Partial<DeployFacts>) => {
      const case_ = { ...facts, deploy: { ...clear, ...deploy } };
      return nextStep(case_, readinessItems(case_));
    };
    expect(at({ qa: "deploying", blocking: [noMain] })).toMatchObject({
      state: "deploying",
      label: "Deploying to QA",
      blockers: 0,
    });
    expect(at({ qa: "deployed" })).toMatchObject({ state: "onQa", label: "On QA" });
    expect(at({ qa: "deployed", qaBehind: true })).toMatchObject({
      state: "steps",
      label: "1 step to QA",
    });
  });
});

describe("the deploy state, as the journey reads it", () => {
  const stage = (stageName: string, status: string, extra: Record<string, unknown> = {}) =>
    ({
      stage: stageName,
      status,
      finishedAt: null,
      metadata: {},
      blocker: null,
      ...extra,
    }) as never;
  const run = (selection: string, status: string, target = "qa") =>
    ({ runId: "r", activityId: "a", target, selection, status, stages: [], metadata: {} }) as never;
  const production = (blocker: unknown = null) => ({ stages: [], blocker, last: null }) as never;

  it("reads a finished QA deploy off the stored stages, so it survives a reload", () => {
    expect(
      qaFact({
        run: null,
        stages: [
          stage("await_activity_deploy", "done", { metadata: { qaActivityUrl: "https://qa/x" } }),
        ],
      }),
    ).toBe("deployed");
    expect(qaFact({ run: null, stages: [stage("await_activity_deploy", "pending")] })).toBe("none");
    expect(qaFact({ run: run("qa", "running"), stages: [] })).toBe("deploying");
    expect(qaFact({ run: run("qa", "failed"), stages: [] })).toBe("failed");
    // A release on its own, or a PROD run, says nothing about QA.
    expect(qaFact({ run: run("release", "running"), stages: [] })).toBe("none");
    expect(qaFact({ run: run("qa", "running", "prod"), stages: [] })).toBe("none");
  });

  it("takes the server's list of blocking problems, and the stages' own when it has none", () => {
    expect(
      deployFacts({ run: null, stages: [], production: production(), blocking: [noMain] }).blocking,
    ).toEqual([noMain]);
    // An older answer: each stage names the first problem only, said once.
    const stages = [
      stage("verify_module", "pending", { blocker: { code: "not_ready", problem: noMain } }),
      stage("prepare_deploy", "pending", { blocker: { code: "not_ready", problem: noMain } }),
      stage("trigger_module_build", "pending", { blocker: { code: "previous_stage", stage: "x" } }),
    ];
    expect(deployFacts({ run: null, stages, production: production() }).blocking).toEqual([noMain]);
  });

  it("says QA is behind only once it has the activity", () => {
    const done = [
      stage("await_activity_deploy", "done", { metadata: { qaActivityUrl: "https://qa/x" } }),
    ];
    const behind = production({ code: "qa_outdated" });
    expect(
      deployFacts({ run: null, stages: done, production: behind, blocking: [] }).qaBehind,
    ).toBe(true);
    expect(deployFacts({ run: null, stages: [], production: behind, blocking: [] }).qaBehind).toBe(
      false,
    );
  });
});

describe("the module, as the journey reads it", () => {
  const build = (inputRevision: string) => ({
    createdAt: "2026-10-12T18:00:00Z",
    finishedAt: "2026-10-12T18:17:00Z",
    inputRevision,
  });

  it("dates the newest build, and says when the draft has changed since", () => {
    expect(
      moduleFacts({
        builds: [build("r2"), build("r1")],
        sandboxModule: false,
        building: false,
        revision: "r2",
      }),
    ).toEqual({
      built: true,
      builtAt: "2026-10-12T18:17:00Z",
      outdated: false,
      building: false,
    });
    expect(
      moduleFacts({ builds: [build("r1")], sandboxModule: false, building: true, revision: "r2" }),
    ).toMatchObject({
      outdated: true,
      building: true,
    });
  });

  it("counts a module only the sandbox knows of as built, with no date", () => {
    expect(
      moduleFacts({ builds: [], sandboxModule: true, building: false, revision: "r" }),
    ).toEqual({
      built: true,
      builtAt: null,
      outdated: false,
      building: false,
    });
  });
});
