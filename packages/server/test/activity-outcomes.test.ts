/**
 * The outcome ledger, through its interface: what it is shown (`witness`, and the deploy events it
 * listens to) against what it answers (`tally`, `history`). Runs are opened in the real run store,
 * as the engine opens them; one case drives a specification run through the engine itself, to pin
 * the moments the engine shows the ledger.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestBegin, requestEnd } from "@prismshadow/penguin-core";
import { HARNESS_VERSION } from "../src/activities/acceptance-harness.js";
import { DISCARDED_PROPOSAL_FILE } from "../src/activities/assist.js";
import type { ActivityDeployEvents } from "../src/activities/deploy-events.js";
import { newId, type ActivityDetail, type ActivityRun } from "../src/activities/domain.js";
import type { ActivityGenerationService } from "../src/activities/generation.js";
import type { LibraryFile } from "../src/activities/outcome-types.js";
import type { ActivityOutcomes } from "../src/activities/outcomes.js";
import { SPEC_OUTPUT } from "../src/activities/run-kinds/spec.js";
import type { ActivityRuns } from "../src/activities/run-store.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { ActivityAuthoring } from "../src/mechanisms/activities.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { activitySpec } from "./activity-fixtures.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";

const PROJECT = "ledger-work";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function libraryFile(
  plugin: string,
  skill: string,
  file: string,
  text: string,
  version = "2026.10.01.1",
): LibraryFile {
  return {
    plugin,
    version,
    skill,
    skillVersion: "2026.09.01.1",
    file,
    sha256: sha(text),
    bytes: Buffer.byteLength(text),
  };
}

const STATE_SKILL = "---\nname: waf-state-machine\n---\n# The state machine\n";
const STATE_API = "# API\nsend(event)\n";
const IMAGE_HELPER = "// draws one image\n";
const LIBRARY = [
  libraryFile("waf-authoring", "waf-state-machine", "SKILL.md", STATE_SKILL),
  libraryFile("waf-authoring", "waf-state-machine", "reference/API.md", STATE_API),
  libraryFile(
    "agent-development",
    "unified-llm-api",
    "scripts/generate-image.mjs",
    IMAGE_HELPER,
    "2026.10.02.1",
  ),
];

describe("the outcome ledger", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function fixture(options: { session?: (row: SessionRow) => RuntimeSession } = {}) {
    const lines: string[] = [];
    const t = await createTestApp({
      log: (line) => lines.push(line),
      activityOutcomePorts: {
        library: () => LIBRARY,
        build: () => ({ penguin: "9.9.9", commit: "c0ffee" }),
      },
    });
    cleanups.push(t.cleanup);
    if (options.session) {
      const session = options.session;
      const adopt = t.deps.manager.adopt.bind(t.deps.manager);
      vi.spyOn(t.deps.manager, "adopt").mockImplementation((row) => adopt(row, session(row)));
    }
    const owner = await provisionUser(t.app, "ledger");
    const client = apiClient(t.app, owner.cookie);
    expect((await client.post("/api/projects", { projectId: PROJECT })).status).toBe(201);
    const base = `/api/projects/${PROJECT}/activities`;
    const activity = (await (
      await client.post(base, { productCode: "p", refNum: 1, title: "One" })
    ).json()) as ActivityDetail;
    const api = <T>(name: string) => t.deps.tree.api<T>("ActivitiesModule", name);
    const outcomes = api<ActivityOutcomes>("ActivityOutcomes");
    const runs = api<ActivityRuns>("ActivityRuns");
    let clock = Date.parse("2026-10-13T10:00:00.000Z");
    const tick = () => new Date((clock += 60_000)).toISOString();
    /** Opens a run as the engine does: recorded, then shown to the ledger. */
    const open = (
      kind: ActivityRun["kind"],
      fields: Partial<ActivityRun> = {},
      witnessed = true,
    ): ActivityRun => {
      const run = {
        kind,
        runId: newId("run"),
        activityId: activity.id,
        projectId: PROJECT,
        draftId: activity.draft.draftId,
        inputRevision: activity.draft.contentRevision,
        agentId: "default_agent",
        sessionId: null,
        status: "running",
        createdAt: tick(),
        finishedAt: null,
        error: null,
        candidate: null,
        ...fields,
      } as ActivityRun;
      runs.open(run);
      if (witnessed) outcomes.witness({ run });
      return run;
    };
    const stage = async (run: ActivityRun, files: Record<string, string>) => {
      for (const [name, text] of Object.entries(files)) {
        const file = path.join(runs.workspace(run.runId), ...name.split("/"));
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, text);
      }
    };
    const start = (run: ActivityRun, modelId = "activity-test", provider = "custom") =>
      outcomes.witness({ run, prompt: "Do the work.", session: { provider, modelId } });
    const settle = (
      run: ActivityRun,
      status: ActivityRun["status"] = "succeeded",
      fields: Partial<ActivityRun> = {},
    ) => {
      Object.assign(run, { status, finishedAt: tick(), ...fields });
      runs.save(run);
      outcomes.witness({ run });
      return run;
    };
    const story = async (run: ActivityRun) =>
      (await outcomes.history(PROJECT, activity.id, run.runId))[0]!;
    return {
      t,
      lines,
      client,
      base,
      activity,
      outcomes,
      runs,
      events: api<ActivityDeployEvents>("ActivityDeployEvents"),
      authoring: api<ActivityAuthoring>("ActivityAuthoring"),
      open,
      stage,
      start,
      settle,
      story,
    };
  }

  it("fixes a run's recipe as its agent starts, from the bundled files its workspace was given", async () => {
    const f = await fixture();
    const assemble = async (modelId: string, provider = "custom", skill = STATE_SKILL) => {
      const run = f.open("module");
      await f.stage(run, {
        "skills/waf-state-machine/SKILL.md": skill,
        "skills/waf-state-machine/reference/API.md": STATE_API,
        "skills/README.md": "# WAF skills for this module\n",
        // An edited copy of a bundled file is not the bundled file.
        "skills/waf-layout/SKILL.md": `${STATE_SKILL}edited\n`,
        "input.json": "{}",
      });
      f.start(run, modelId, provider);
      // What the agent then writes in its workspace changes nothing already fixed.
      await f.stage(run, { "skills/waf-state-machine/SKILL.md": "rewritten" });
      return f.settle(run);
    };
    const first = await assemble("activity-test");
    const second = await assemble("activity-test");
    await assemble("claude", "coding-agent");
    // Given a skill that is not the bundled one, a run has another recipe.
    await assemble("activity-test", "custom", "rewritten");

    const story = await f.story(first);
    expect(story.recipe).toEqual({
      runtime: "agent:custom/activity-test",
      library: [
        {
          plugin: "waf-authoring",
          version: "2026.10.01.1",
          skills: [
            { name: "waf-state-machine", version: "2026.09.01.1", sha256: expect.any(String) },
          ],
        },
      ],
      harness: HARNESS_VERSION,
      penguin: "9.9.9",
    });
    expect(story.facts.map((fact) => [fact.fact, fact.detail])).toEqual([
      ["opened", {}],
      ["started", { runtime: "agent:custom/activity-test", prompt: sha("Do the work.") }],
      ["settled", { status: "succeeded" }],
      ["superseded", { by: second.runId }],
    ]);

    const byRecipe = await f.outcomes.tally({ kind: "module" });
    expect(byRecipe.map((tally) => tally.runs)).toEqual([2, 1, 1]);
    expect(byRecipe[0]).toMatchObject({ recipe: story.recipe, metrics: { succeeded: 2 } });
    // Each run took the minute between opening and ending, and a later one supersedes it.
    expect(byRecipe[0]!.metrics).toMatchObject({ seconds: 120, superseded: 2 });
    const byRuntime = await f.outcomes.tally({ kind: "module", by: "runtime" });
    expect(byRuntime.map((tally) => [tally.key, tally.runs, tally.recipe])).toEqual([
      ["agent:custom/activity-test", 3, null],
      ["coding:claude", 1, null],
    ]);
    const byLibrary = await f.outcomes.tally({ kind: "module", by: "library" });
    expect(byLibrary.map((tally) => tally.runs)).toEqual([3, 1]);
    expect(await f.outcomes.tally({ kind: "module", by: "harness" })).toMatchObject([
      { key: String(HARNESS_VERSION), runs: 4 },
    ]);
    expect(await f.outcomes.tally({ kind: "spec" })).toEqual([]);
    expect(await f.outcomes.tally({ kind: "module", activityIds: [] })).toEqual([]);
    expect(await f.outcomes.tally({ kind: "module", since: "2026-10-14T00:00:00.000Z" })).toEqual(
      [],
    );
  });

  it("names a media helper the server runs for an agent, and the helper it staged", async () => {
    const f = await fixture();
    const run = f.open("image", {
      agentId: "media_agent",
      image: { language: "en-US", assetKey: "cover" },
    } as Partial<ActivityRun>);
    await f.stage(run, { "generate-image.mjs": IMAGE_HELPER, "image-input.json": "{}" });
    f.outcomes.witness({ run, server: "helper:generate-image.mjs" });
    f.settle(run);
    expect((await f.story(run)).recipe).toEqual({
      runtime: "helper:generate-image.mjs",
      library: [
        {
          plugin: "agent-development",
          version: "2026.10.02.1",
          skills: [
            { name: "unified-llm-api", version: "2026.09.01.1", sha256: expect.any(String) },
          ],
        },
      ],
      penguin: "9.9.9",
    });
  });

  it("knows no recipe for a run it first sees ending, nor for one whose agent never started", async () => {
    const f = await fixture();
    const earlier = f.open("spec", {}, false);
    f.settle(earlier);
    expect(await f.story(earlier)).toMatchObject({
      recipe: null,
      facts: [{ fact: "settled", detail: { status: "succeeded" } }],
    });
    const refused = f.open("spec");
    f.settle(refused, "failed");
    expect((await f.story(refused)).recipe).toBeNull();
    // Both stay out of every tally.
    expect(await f.outcomes.tally({ kind: "spec" })).toEqual([]);

    // Work no agent has a part in is the server's from the moment it opens.
    const quality = f.open("quality", { agentId: "" });
    f.settle(quality, "failed");
    expect(await f.outcomes.tally({ kind: "quality" })).toEqual([
      {
        key: expect.any(String),
        recipe: { runtime: "server", library: [], penguin: "9.9.9" },
        runs: 1,
        metrics: { failed: 1, seconds: 60 },
      },
    ]);
  });

  it("keeps what a run's checks found as it ends, and credits a test's numbers to the build it played", async () => {
    const f = await fixture();
    const build = f.open("module");
    f.start(build);
    await f.stage(build, {
      "player-check/acceptance-results.json": JSON.stringify({
        results: [{ status: "passed" }, { status: "failed" }],
      }),
    });
    f.settle(build);

    const test = f.open("test");
    f.start(test);
    const report = {
      overallStatus: "failed",
      results: [
        { criterion: "a", testName: "a", status: "passed", durationMs: 1, error: null },
        { criterion: "b", testName: "b", status: "failed", durationMs: 1, error: "saw c" },
        {
          criterion: "c",
          testName: "",
          status: "failed",
          durationMs: 0,
          error: "x",
          code: "not_run",
        },
      ],
      checkedAt: "2026-10-13T10:00:00.000Z",
      specRevision: null,
      reused: true,
    };
    await f.stage(test, { "reports/test.json": JSON.stringify(report) });
    f.settle(test);
    // A later change to the run's folder changes nothing already kept.
    await f.stage(test, { "reports/test.json": JSON.stringify({ ...report, results: [] }) });
    f.outcomes.witness({ run: test });

    expect((await f.outcomes.tally({ kind: "test" }))[0]!.metrics).toEqual({
      succeeded: 1,
      seconds: 60,
      "tests.passed": 1,
      "tests.failed": 1,
      "tests.notRun": 1,
      "tests.reused": 1,
    });
    expect((await f.outcomes.tally({ kind: "module" }))[0]!.metrics).toEqual({
      succeeded: 1,
      seconds: 60,
      "playerCheck.passed": 1,
      "playerCheck.failed": 1,
      "judged.tests.passed": 1,
      "judged.tests.failed": 1,
      "judged.tests.notRun": 1,
      "judged.tests.reused": 1,
    });
    expect((await f.story(test)).facts.find((fact) => fact.fact === "opened")?.detail).toEqual({
      judges: build.runId,
    });
    expect((await f.story(build)).facts.at(-1)).toMatchObject({
      fact: "judged",
      detail: { by: test.runId, kind: "test", "tests.failed": 1 },
    });

    // The next test's numbers replace the last one's on the build.
    const again = f.open("test");
    f.start(again);
    await f.stage(again, {
      "reports/test.json": JSON.stringify({
        ...report,
        results: [report.results[0]],
        reused: false,
      }),
    });
    f.settle(again);
    expect((await f.outcomes.tally({ kind: "module" }))[0]!.metrics).toEqual({
      succeeded: 1,
      seconds: 60,
      "playerCheck.passed": 1,
      "playerCheck.failed": 1,
      "judged.tests.passed": 1,
    });
  });

  it("judges the build the preview plays: the one pinned on the draft, else the newest", async () => {
    const f = await fixture();
    const older = f.open("module");
    f.settle(older);
    const newer = f.open("module");
    f.settle(newer);
    const judged = () => {
      const test = f.open("test");
      f.settle(test, "failed");
      return f
        .story(test)
        .then((story) => story.facts.find((fact) => fact.fact === "opened")?.detail.judges);
    };
    expect(await judged()).toBe(newer.runId);
    const revision = async () =>
      (await f.authoring.getActivity(PROJECT, f.activity.id)).draft.contentRevision;
    await f.authoring.pinModuleRun(PROJECT, f.activity.id, older.runId, await revision());
    expect(await judged()).toBe(older.runId);
    await f.authoring.pinModuleRun(PROJECT, f.activity.id, null, await revision());
    expect(await judged()).toBe(newer.runId);
  });

  it("marks an earlier run superseded when a later one of the same target opens", async () => {
    const f = await fixture();
    const image = (assetKey: string) =>
      f.settle(f.open("image", { image: { language: "en-US", assetKey } } as Partial<ActivityRun>));
    const first = image("cover");
    const second = image("cover");
    const third = image("story-1");
    expect((await f.story(first)).facts.at(-1)).toMatchObject({
      fact: "superseded",
      detail: { by: second.runId },
    });
    for (const run of [second, third])
      expect((await f.story(run)).facts.some((fact) => fact.fact === "superseded")).toBe(false);
    // A conversation never supersedes another.
    const talk = () =>
      f.settle(f.open("assist", { assist: { focus: null } } as Partial<ActivityRun>));
    const chat = talk();
    talk();
    expect((await f.story(chat)).facts.map((fact) => fact.fact)).toEqual(["opened", "settled"]);
  });

  it("counts each time an assist run's proposal is discarded", async () => {
    const f = await fixture();
    const chat = f.open("assist", { assist: { focus: null } } as Partial<ActivityRun>);
    f.start(chat);
    f.settle(chat);
    await f.stage(chat, { [DISCARDED_PROPOSAL_FILE]: "{}" });
    f.outcomes.witness({ run: chat });
    f.outcomes.witness({ run: chat });
    expect((await f.outcomes.tally({ kind: "assist" }))[0]!.metrics).toMatchObject({
      discarded: 1,
    });
  });

  it("credits the module build a deploy shipped, on each target it reached", async () => {
    const f = await fixture();
    const build = f.open("module");
    f.start(build);
    f.settle(build);
    const other = f.open("module");
    f.start(other);
    f.settle(other);
    const deployed = (target: "qa" | "prod", moduleRunId: string | null) =>
      f.events.emit({
        projectId: PROJECT,
        activityId: f.activity.id,
        runId: `dep_${target}`,
        target,
        revision: null,
        moduleRunId,
        deployedAt: "2026-10-13T12:00:00.000Z",
      });
    deployed("qa", build.runId);
    deployed("prod", build.runId);
    // A build the ledger never saw, or none at all, credits nothing.
    deployed("qa", newId("run"));
    deployed("qa", null);
    // The versions mark each deploy too, holding the activity: let them finish first.
    await f.authoring.exclusive(PROJECT, f.activity.id, async () => {});
    const tallies = await f.outcomes.tally({ kind: "module", by: "runtime" });
    expect(tallies[0]!.metrics).toMatchObject({ "deployed.qa": 1, "deployed.prod": 1 });
    expect((await f.story(build)).facts.filter((fact) => fact.fact === "deployed")).toEqual([
      {
        fact: "deployed",
        at: "2026-10-13T12:00:00.000Z",
        detail: { target: "qa", deploy: "dep_qa", as: "build" },
      },
      {
        fact: "deployed",
        at: "2026-10-13T12:00:00.000Z",
        detail: { target: "prod", deploy: "dep_prod", as: "build" },
      },
    ]);
    expect((await f.story(other)).facts.some((fact) => fact.fact === "deployed")).toBe(false);
  });

  it("never throws into its caller: a moment it cannot keep is logged and dropped", async () => {
    const f = await fixture();
    // A run the run store never recorded cannot be kept.
    const stray = { ...f.settle(f.open("spec")), runId: newId("run") } as ActivityRun;
    expect(() => f.outcomes.witness({ run: stray })).not.toThrow();
    expect(f.lines.some((line) => line.includes(`could not record run ${stray.runId}`))).toBe(true);
    expect(await f.outcomes.history(PROJECT, f.activity.id, stray.runId)).toEqual([]);
  });

  it("is shown a specification run by the engine as it opens, as its Session starts and as it ends", async () => {
    let finish: () => void = () => {};
    const f = await fixture({
      session: (row) => ({
        sessionId: row.sessionId,
        dispose: () => {},
        toolPermission: () => "rw",
        generateTitle: async () => ({ title: null, usage: null }),
        compactability: () => "ok",
        steer: () => false,
        skipReconnectWait: () => false,
        async *compact() {},
        async *run() {
          yield requestBegin();
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          await fs.writeFile(path.join(row.workspace!, SPEC_OUTPUT), JSON.stringify(activitySpec));
          yield requestEnd("completed");
        },
      }),
    });
    await f.t.deps.projectConfigService.writeRaw(PROJECT, {
      default_model: { provider: "custom", model_id: "activity-test" },
      models: [
        {
          provider: "custom",
          model_id: "activity-test",
          api_key: "not-a-real-key",
          base_url: "http://localhost:1/v1",
          client_type: "openai-chat",
        },
      ],
    });
    const endpoint = `${f.base}/${f.activity.id}`;
    const described = await f.client.patch(`${endpoint}/description`, {
      description: "Teach sight words",
      expectedRevision: f.activity.draft.contentRevision,
    });
    const started = await f.client.post(`${endpoint}/generate-spec`, {
      agentId: "default_agent",
      expectedRevision: ((await described.json()) as { contentRevision: string }).contentRevision,
    });
    expect(started.status, await started.clone().text()).toBe(202);
    const run = (await started.json()) as ActivityRun;
    expect((await f.story(run)).facts.map((fact) => fact.fact)).toEqual(["opened", "started"]);
    finish();
    await waitFor(() => f.t.deps.manager.statusOf(run.sessionId!) === "idle");
    await f.t.deps.tree
      .api<ActivityGenerationService>("ActivitiesModule", "ActivityGeneration")
      .reconcile();
    const story = await f.story(run);
    // The Project's default model, as the Session was created with it.
    expect(story.recipe).toEqual({
      runtime: "agent:custom/activity-test",
      library: [],
      penguin: "9.9.9",
    });
    expect(story.facts.map((fact) => [fact.fact, fact.detail.status])).toEqual([
      ["opened", undefined],
      ["started", undefined],
      ["settled", "succeeded"],
    ]);
  });
});
