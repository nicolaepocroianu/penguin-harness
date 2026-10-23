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
import { requestBegin, requestEnd } from "@waterford/waf-harness-core";
import { HARNESS_VERSION } from "../src/activities/acceptance-harness.js";
import { DISCARDED_PROPOSAL_FILE } from "../src/activities/assist.js";
import type { ActivityDeployEvents } from "../src/activities/deploy-events.js";
import {
  newId,
  type ActivityDetail,
  type ActivityDraft,
  type ActivityRun,
} from "../src/activities/domain.js";
import type { ActivityGenerationService } from "../src/activities/generation.js";
import type { LibraryFile } from "../src/activities/outcome-types.js";
import type { ActivityOutcomes } from "../src/activities/outcomes.js";
import { SPEC_OUTPUT } from "../src/activities/run-kinds/spec.js";
import type { ActivityRuns } from "../src/activities/run-store.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { ActivityAuthoring } from "../src/mechanisms/activities.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { activitySpec } from "./activity-fixtures.js";
import { imagePng } from "./image-fixtures.js";
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
        build: () => ({ wafh: "9.9.9", commit: "c0ffee" }),
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
      wafh: "9.9.9",
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
      wafh: "9.9.9",
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
        recipe: { runtime: "server", library: [], wafh: "9.9.9" },
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

    // A report whose run changed what its checks rest on counts as untrusted, and nothing more.
    const tampered = f.open("test");
    f.start(tampered);
    await f.stage(tampered, {
      "reports/test.json": JSON.stringify({ ...report, untrusted: true }),
    });
    f.settle(tampered);
    expect((await f.story(tampered)).facts.find((fact) => fact.fact === "checks")?.detail).toEqual({
      "tests.untrusted": 1,
    });
    expect((await f.outcomes.tally({ kind: "module" }))[0]!.metrics).toEqual({
      succeeded: 1,
      seconds: 60,
      "playerCheck.passed": 1,
      "playerCheck.failed": 1,
      "judged.tests.untrusted": 1,
    });
  });

  it("counts a player check whose run changed what it rests on as untrusted, and its module unchecked", async () => {
    const f = await fixture();
    const results = JSON.stringify({ results: [{ status: "passed" }, { status: "passed" }] });
    const staged = { "activity-harness.mjs": "a".repeat(64) };
    const checks = async (run: ActivityRun) =>
      (await f.story(run)).facts.find((fact) => fact.fact === "checks")?.detail;
    const assembled = async (fields: Partial<ActivityRun>) => {
      const run = f.open("module", { playerCheck: { staged } });
      f.start(run);
      await f.stage(run, { "player-check/acceptance-results.json": results });
      return f.settle(run, "succeeded", fields);
    };
    expect(await checks(await assembled({}))).toEqual({ "playerCheck.passed": 2 });
    // Its results count for nothing, and the module was not seen to play.
    expect(await checks(await assembled({ playerCheck: { staged, untrusted: true } }))).toEqual({
      "playerCheck.untrusted": 1,
      "unchecked.untrusted": 1,
    });
    // A module unchecked for a reason of its own keeps that reason.
    expect(
      await checks(
        await assembled({ unchecked: "notRun", playerCheck: { staged, untrusted: true } }),
      ),
    ).toEqual({ "playerCheck.untrusted": 1, "unchecked.notRun": 1 });
  });

  it("judges the build a test run names, else the one the preview plays: pinned, else the newest", async () => {
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
    // A test run that names the build it plays judges that one, whatever the preview plays.
    const named = f.open("test", {
      test: {
        criteria: ["It starts."],
        specRevision: "s",
        harnessVersion: 2,
        reused: false,
        moduleRunId: older.runId,
      },
    } as Partial<ActivityRun>);
    f.settle(named, "failed");
    expect((await f.story(named)).facts[0]!.detail.judges).toBe(older.runId);
  });

  it("counts a run of another kind amending a part as an edit by a run, not a takeover", async () => {
    const f = await fixture();
    const revision = async () =>
      (await f.authoring.getActivity(PROJECT, f.activity.id)).draft.contentRevision;
    /** A run that applies its own specification, as a specification or media pass does. */
    const pass = async (kind: "spec" | "media-spec", spec: Record<string, unknown>) => {
      const run = f.open(kind);
      f.start(run);
      await f.outcomes.attribute({ actor: "run", runId: run.runId }, async () =>
        f.authoring.applySpec(PROJECT, f.activity.id, spec, await revision()),
      );
      return f.settle(run);
    };
    const spec = await pass("spec", activitySpec);
    const media = await pass("media-spec", { ...activitySpec, title: "Sight words, with media" });
    const specs = (await f.outcomes.tally({ kind: "spec" }))[0]!.metrics;
    expect(specs).toMatchObject({ accepted: 1, "accepted.run": 1, "edits.run": 1 });
    expect(specs.replaced).toBeUndefined();
    expect(specs["editedBytes.run"]).toBeGreaterThan(0);
    expect((await f.outcomes.tally({ kind: "media-spec" }))[0]!.metrics).toMatchObject({
      accepted: 1,
      "accepted.run": 1,
    });
    expect((await f.story(media)).facts.find((fact) => fact.fact === "part")?.detail).toMatchObject(
      {
        part: "spec",
        change: "amend",
        fromRun: spec.runId,
        run: spec.runId,
        amendedBy: media.runId,
      },
    );
    // The specification is still the first pass's, amended: a deploy credits both.
    f.events.emit({
      projectId: PROJECT,
      activityId: f.activity.id,
      runId: "dep_qa",
      target: "qa",
      revision: await revision(),
      moduleRunId: null,
      deployedAt: "2026-10-13T12:00:00.000Z",
    });
    await f.authoring.exclusive(PROJECT, f.activity.id, async () => {});
    for (const run of [spec, media])
      expect((await f.story(run)).facts.at(-1)).toMatchObject({
        fact: "deployed",
        detail: { as: "part" },
      });
    // A later pass of the same kind takes the part over.
    await pass("spec", { ...activitySpec, title: "Sight words again" });
    const again = (await f.outcomes.tally({ kind: "spec" }))[0]!.metrics;
    expect(again).toMatchObject({ accepted: 2, replaced: 1 });
  });

  it("credits who started a run with accepting it when no actor is named, else the run", async () => {
    const f = await fixture();
    const revision = async () =>
      (await f.authoring.getActivity(PROJECT, f.activity.id)).draft.contentRevision;
    const accept = (run: ActivityRun, text: string) =>
      f.outcomes.attribute({ runId: run.runId }, async () =>
        f.authoring.updateDescription(PROJECT, f.activity.id, text, await revision()),
      );
    const staged = await f.outcomes.attribute({ actor: "stages" }, async () =>
      f.settle(f.open("assist", { assist: { focus: null } } as Partial<ActivityRun>)),
    );
    f.start(staged);
    await accept(staged, "Teach one sight word");
    const nobody = f.settle(f.open("assist", { assist: { focus: null } } as Partial<ActivityRun>));
    f.start(nobody);
    await accept(nobody, "Teach two sight words");
    const accepted = async (run: ActivityRun) =>
      (await f.story(run)).facts.find((fact) => fact.fact === "accepted")?.detail.actor;
    expect(await accepted(staged)).toBe("stages");
    expect(await accepted(nobody)).toBe("run");
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

  /** Changes the draft's script through the author's own route, as the studio does. */
  async function describeAs(f: Awaited<ReturnType<typeof fixture>>, description: string) {
    const current = await f.authoring.getActivity(PROJECT, f.activity.id);
    const response = await f.client.patch(`${f.base}/${f.activity.id}/description`, {
      description,
      expectedRevision: current.draft.contentRevision,
    });
    expect(response.status, await response.clone().text()).toBe(200);
  }

  it("counts what authors and nobody change against the run that wrote the part", async () => {
    const f = await fixture();
    const endpoint = `${f.base}/${f.activity.id}`;
    await describeAs(f, "Teach sight words");
    /** A conversation that proposed a script, applied through the studio's route. */
    const propose = async (text: string) => {
      const chat = f.open("assist", { assist: { focus: null } } as Partial<ActivityRun>);
      f.start(chat);
      f.settle(chat);
      await f.stage(chat, {
        "proposal.json": JSON.stringify({ changes: [{ target: "description", text }] }),
      });
      const current = await f.authoring.getActivity(PROJECT, f.activity.id);
      const applied = await f.client.post(`${endpoint}/runs/${chat.runId}/proposal/apply`, {
        expectedRevision: current.draft.contentRevision,
      });
      expect(applied.status, await applied.clone().text()).toBe(200);
      return chat;
    };
    const first = await propose("Teach three sight words");
    expect((await f.story(first)).facts.slice(-2)).toMatchObject([
      { fact: "part", detail: { part: "script", change: "accept", actor: "author" } },
      { fact: "accepted", detail: { actor: "author" } },
    ]);
    await describeAs(f, "Teach four sight words");
    // Nothing names who made this one.
    await f.authoring.updateDescription(
      PROJECT,
      f.activity.id,
      "Teach five sight words",
      (await f.authoring.getActivity(PROJECT, f.activity.id)).draft.contentRevision,
    );
    const second = await propose("Teach six sight words");
    // Back to the script the author wrote before either conversation.
    await describeAs(f, "Teach sight words");

    const metrics = (await f.outcomes.tally({ kind: "assist" }))[0]!.metrics;
    expect(metrics).toMatchObject({
      accepted: 2,
      "accepted.author": 2,
      "edits.author": 1,
      "edits.unattributed": 1,
      replaced: 1,
      reverted: 1,
    });
    expect(metrics["editedBytes.author"]).toBeGreaterThan(0);
    expect(metrics["editedBytes.unattributed"]).toBeGreaterThan(0);
    expect(
      (await f.story(first)).facts.map((fact) => [
        fact.fact,
        fact.detail.change,
        fact.detail.actor,
      ]),
    ).toEqual([
      ["opened", undefined, undefined],
      ["started", undefined, undefined],
      ["settled", undefined, undefined],
      ["part", "accept", "author"],
      ["accepted", undefined, "author"],
      ["part", "edit", "author"],
      ["part", "edit", "unattributed"],
    ]);
    expect((await f.story(second)).facts.at(-1)).toMatchObject({
      fact: "part",
      detail: { change: "revert", actor: "author", fromRun: second.runId, run: null },
    });
  });

  it("keeps who a part came from across a renumbered ref and a pinned build, which edit nothing", async () => {
    const f = await fixture();
    const endpoint = `${f.base}/${f.activity.id}`;
    const specced = await f.client.post(`${endpoint}/apply-generated-spec`, {
      spec: {
        ...activitySpec,
        scenes: [
          {
            id: "intro",
            description: "Look",
            media: { images: [{ key: "cat", description: "A cat" }] },
          },
        ],
      },
      expectedRevision: f.activity.draft.contentRevision,
    });
    const planned = (await (
      await f.client.post(`${endpoint}/plan-media`, {
        expectedRevision: ((await specced.json()) as ActivityDraft).contentRevision,
      })
    ).json()) as ActivityDraft;
    const image = f.open("image", {
      inputRevision: planned.contentRevision,
      image: { language: "en-US", assetKey: "cat", prompt: "A cat", model: "m" },
    } as Partial<ActivityRun>);
    f.start(image);
    const drawn = await f.authoring.storeImage(PROJECT, f.activity.id, image.runId, imagePng(2, 2));
    f.settle(image, "succeeded", { candidate: JSON.stringify(drawn) });
    // Accepted by the author, through the engine's accept.
    const accepted = await f.client.post(`${endpoint}/runs/${image.runId}/accept-image`, {
      expectedRevision: planned.contentRevision,
    });
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    expect((await f.outcomes.tally({ kind: "image" }))[0]!.metrics).toMatchObject({
      accepted: 1,
      "accepted.author": 1,
    });
    const before = (await f.story(image)).facts.length;
    const revision = async () =>
      (await f.authoring.getActivity(PROJECT, f.activity.id)).draft.contentRevision;

    // A new number moves the image's file and rewrites its path outside any change.
    const renumbered = await f.client.post(`${endpoint}/ref-number`, {
      refNum: 2,
      expectedRevision: await revision(),
    });
    expect(renumbered.status, await renumbered.clone().text()).toBe(200);
    // Pinning a build changes which build plays, not the draft's content.
    const build = f.settle(f.open("module"));
    await fs.mkdir(path.join(f.t.root, "activity-runs", build.runId, "module"), {
      recursive: true,
    });
    const pinned = await f.client.post(`${endpoint}/module-builds/${build.runId}/pin`, {
      expectedRevision: await revision(),
    });
    expect(pinned.status, await pinned.clone().text()).toBe(200);
    await describeAs(f, "Look at the cat");

    expect((await f.story(image)).facts).toHaveLength(before);
    expect((await f.outcomes.tally({ kind: "image" }))[0]!.metrics).toEqual({
      succeeded: 1,
      seconds: 60,
      accepted: 1,
      "accepted.author": 1,
    });
    // The image is still the run's: a deploy of the draft as it is credits it.
    f.events.emit({
      projectId: PROJECT,
      activityId: f.activity.id,
      runId: "dep_qa",
      target: "qa",
      revision: null,
      moduleRunId: null,
      deployedAt: "2026-10-13T12:00:00.000Z",
    });
    await f.authoring.exclusive(PROJECT, f.activity.id, async () => {});
    expect((await f.story(image)).facts.at(-1)).toMatchObject({
      fact: "deployed",
      detail: { target: "qa", as: "part" },
    });
  });

  /** A specification run's Session, held until the test lets it write and finish. */
  function specSessions() {
    let finish: (() => void) | null = null;
    const session = (row: SessionRow): RuntimeSession => ({
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
    });
    return {
      session,
      waiting: () => finish !== null,
      finish: () => {
        finish?.();
        finish = null;
      },
    };
  }

  /** The Project's default model, and a script to generate from. */
  async function readyForSpec(f: Awaited<ReturnType<typeof fixture>>) {
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
    await describeAs(f, "Teach sight words");
  }

  async function settleSpec(
    f: Awaited<ReturnType<typeof fixture>>,
    sessions: ReturnType<typeof specSessions>,
    run: ActivityRun,
  ) {
    sessions.finish();
    await waitFor(() => f.t.deps.manager.statusOf(run.sessionId!) === "idle");
    await f.t.deps.tree
      .api<ActivityGenerationService>("ActivitiesModule", "ActivityGeneration")
      .reconcile();
  }

  it("is shown a specification run by the engine as it opens, as its Session starts and as it ends", async () => {
    const sessions = specSessions();
    const f = await fixture({ session: sessions.session });
    await readyForSpec(f);
    const started = await f.client.post(`${f.base}/${f.activity.id}/generate-spec`, {
      agentId: "default_agent",
      expectedRevision: (await f.authoring.getActivity(PROJECT, f.activity.id)).draft
        .contentRevision,
    });
    expect(started.status, await started.clone().text()).toBe(202);
    const run = (await started.json()) as ActivityRun;
    expect((await f.story(run)).facts.map((fact) => fact.fact)).toEqual(["opened", "started"]);
    await settleSpec(f, sessions, run);
    const story = await f.story(run);
    // The Project's default model, as the Session was created with it.
    expect(story.recipe).toEqual({
      runtime: "agent:custom/activity-test",
      library: [],
      wafh: "9.9.9",
    });
    // An author started it, and the run applied its own specification.
    expect(story.facts.map((fact) => [fact.fact, fact.detail])).toEqual([
      ["opened", { by: "author" }],
      ["started", expect.anything()],
      ["part", expect.objectContaining({ part: "spec", change: "accept", actor: "run" })],
      ["accepted", { actor: "run" }],
      ["settled", { status: "succeeded" }],
    ]);
  });

  it("ties a run the Stages start to them, even when the run applies its own result", async () => {
    const sessions = specSessions();
    const f = await fixture({ session: sessions.session });
    await readyForSpec(f);
    const endpoint = `${f.base}/${f.activity.id}`;
    const pipeline = await f.client.post(`${endpoint}/pipeline`, {
      stage: "spec",
      agentId: "default_agent",
    });
    expect(pipeline.status, await pipeline.clone().text()).toBe(202);
    await waitFor(sessions.waiting, 10_000);
    const [summary] = f.runs.summaries(PROJECT, f.activity.id, { kind: "spec" });
    const run = summary as unknown as ActivityRun;
    await settleSpec(f, sessions, run);
    const stages = async () =>
      (
        (await (await f.client.get(`${endpoint}/pipeline`)).json()) as {
          pipeline: { status: string };
        }
      ).pipeline.status;
    await vi.waitFor(async () => expect(await stages()).toBe("succeeded"));
    expect((await f.story(run)).facts.find((fact) => fact.fact === "opened")?.detail).toEqual({
      by: "stages",
    });
    expect((await f.outcomes.tally({ kind: "spec" }))[0]!.metrics).toMatchObject({
      "startedBy.stages": 1,
      accepted: 1,
      "accepted.run": 1,
    });
  });
});
