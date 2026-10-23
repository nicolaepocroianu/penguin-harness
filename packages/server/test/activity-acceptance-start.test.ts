/**
 * Run tests, over HTTP: when a test run is refused, when it finishes skipped without a
 * Session, what it stages for its agent, how its results become the report, and when it
 * reuses an earlier run's tests, which the server runs itself with no agent (decision 17).
 *
 * No browser starts and no model is called: the test browser's "executable" is a file this
 * test writes, the Session is a fake whose agent writes the files a real one would, and the
 * server's own run of earlier tests is a stand-in that answers what the runner would have.
 * activity-confined-checks.test.ts runs real checks in a real browser.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestBegin, requestEnd } from "@prismshadow/penguin-core";
import {
  newId,
  type ActivityDetail,
  type ActivityRun,
  type ActivityRunSummary,
} from "../src/activities/domain.js";
import type { ActivityAcceptance } from "../src/activities/acceptance-service.js";
import type { ActivityRuns } from "../src/activities/run-store.js";
import type { ActivityGenerationService } from "../src/activities/generation.js";
import type { AcceptanceStateResponse } from "../src/activities/acceptance-types.js";
import {
  acceptancePrompt,
  activityHarnessSource,
  runAcceptanceSource,
} from "../src/activities/acceptance-harness.js";
import type { ChecksOutcome, ConfinedChecksRequest } from "../src/activities/confined-checks.js";
import { readPlayKey } from "../src/activities/play-links.js";
import { INSTALL_MARKER } from "../src/activities/test-browser.js";
import { PLAYER_CHECK_DIR } from "../src/activities/waf-module.js";
import { SandboxService } from "../src/sandbox/service.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import { activitySpec, createCheckoutActivity } from "./activity-fixtures.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";

const FOLDER = "waf-module-sight-words";
const CODE = "sight-words";
const CRITERIA = ["Tapping the cat plays its name.", "The end screen says well done."];

async function write(file: string, content: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, typeof content === "string" ? content : JSON.stringify(content));
}

/** A checkout with one Loom module of two scenes; built unless `built` is false. */
async function checkout(options: { criteria: string[]; built: boolean }): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "waf-acceptance-"));
  await write(path.join(root, "framework", "package.json"), { version: "9.9.9" });
  await fs.mkdir(path.join(root, "framework", "src"), { recursive: true });
  await fs.mkdir(path.join(root, "media", "loom"), { recursive: true });
  const spec = {
    ...activitySpec,
    scenes: [
      { id: "intro", description: "Tap the cat" },
      { id: "end", description: "Well done" },
    ],
    ...(options.criteria.length ? { acceptance_criterias: options.criteria } : {}),
  };
  const product = path.join(root, "modules", FOLDER, "generated", CODE);
  await write(path.join(product, "spec", "activity_metadata.json"), {
    title: "Sight Words",
    canonicalRefNum: 1,
    activityType: "standard",
    moduleFolder: FOLDER,
  });
  const ref = path.join(product, "refs", `${CODE}-1`, "spec");
  await write(path.join(ref, "activity_metadata.json"), { refNum: 1, title: "Sight Words 1" });
  await write(path.join(ref, "activity_spec.json"), spec);
  await write(path.join(ref, "asset_manifest.json"), { assets: { "en-US": [] } });
  await write(path.join(ref, "activity_description.txt"), "Ref 1");
  const module = path.join(root, "modules", FOLDER);
  if (options.built)
    await write(path.join(module, "definition.json"), {
      id: "sightWords",
      require: {
        entry: { type: "javascript", url: "entry.js" },
        layout: { type: "html", url: "layout.html" },
      },
    });
  await write(path.join(module, "package.json"), { version: "1.0.0" });
  await write(path.join(module, "configurations", `${CODE}-1.json`), { sightWords: {} });
  return root;
}

const executableIn = (dir: string) => path.join(dir, "chromium-0000", "chrome");

/** What the fake agent does in its workspace, and what it saw there when it started. */
type Agent = (workspace: string) => Promise<void>;
const writesResults =
  (results: unknown, test = "// the agent's tests\n"): Agent =>
  async (workspace) => {
    await fs.writeFile(path.join(workspace, "acceptance.test.mjs"), test, { flag: "w" });
    await fs.writeFile(
      path.join(workspace, "acceptance-results.json"),
      typeof results === "string" ? results : JSON.stringify(results),
    );
  };

describe("acceptance test runs", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    // Last in, first out: a second setup restores the WAF_ROOT_DIR the first one set, and the
    // first one's cleanup then restores what was there before either.
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function setup(
    options: {
      criteria?: string[];
      built?: boolean;
      installed?: boolean;
      sandbox?: SandboxService;
    } = {},
  ) {
    const root = await checkout({
      criteria: options.criteria ?? CRITERIA,
      built: options.built ?? true,
    });
    const previous = process.env.WAF_ROOT_DIR;
    process.env.WAF_ROOT_DIR = root;
    // The browser server a confined run's checks connect to: a stand-in that records its life.
    const browserServers: { endpoint: string; closed: boolean }[] = [];
    // The server's own run of earlier tests: a stand-in that records what it was asked.
    let checks: (request: ConfinedChecksRequest) => Promise<ChecksOutcome> = async () => ({
      ran: true,
      results: JSON.stringify({ results: [] }),
    });
    const checked: ConfinedChecksRequest[] = [];
    const t = await createTestApp({
      ...(options.sandbox ? { sandbox: options.sandbox } : {}),
      testBrowserPorts: {
        locateExecutable: async (dir) => executableIn(dir),
        launchServer: async () => {
          const server = {
            endpoint: `ws://127.0.0.1:1/browser-${browserServers.length + 1}`,
            closed: false,
          };
          browserServers.push(server);
          return {
            endpoint: server.endpoint,
            close: async () => {
              server.closed = true;
            },
          };
        },
        runChecks: (request) => {
          checked.push(request);
          return checks(request);
        },
      },
    });
    cleanups.push(async () => {
      if (previous === undefined) delete process.env.WAF_ROOT_DIR;
      else process.env.WAF_ROOT_DIR = previous;
      await t.cleanup();
      await fs.rm(root, { recursive: true, force: true });
    });
    const home = path.join(t.root, "browsers");
    if (options.installed !== false) {
      await write(executableIn(home), "fake browser");
      await write(path.join(home, "chromium-0000", INSTALL_MARKER), "");
    }

    let agent: Agent = writesResults({ results: [] });
    const prompts: string[] = [];
    const seen: string[][] = [];
    const sessions: string[] = [];
    const fakeSession = (row: SessionRow): RuntimeSession => ({
      sessionId: row.sessionId,
      dispose: () => {},
      toolPermission: () => "rw",
      generateTitle: async () => ({ title: null, usage: null }),
      compactability: () => "ok",
      steer: () => false,
      skipReconnectWait: () => false,
      async *compact() {},
      async *run(input) {
        prompts.push(JSON.stringify(input));
        yield requestBegin();
        seen.push((await fs.readdir(row.workspace!)).sort());
        await agent(row.workspace!);
        yield requestEnd("completed");
      },
    });
    const adopt = t.deps.manager.adopt.bind(t.deps.manager);
    vi.spyOn(t.deps.manager, "adopt").mockImplementation((row) => {
      sessions.push(row.sessionId);
      return adopt(row, fakeSession(row));
    });

    const owner = await provisionUser(t.app, "tests_owner");
    const client = apiClient(t.app, owner.cookie);
    const projectId = "tests_owner-tests";
    await client.post("/api/projects", { projectId, name: "Tests" });
    await t.deps.projectConfigService.writeRaw(projectId, {
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
    const activityId = await createCheckoutActivity(client, projectId, root, CODE);
    const endpoint = `/api/projects/${projectId}/activities/${activityId}`;
    const service = t.deps.tree.api<ActivityGenerationService>(
      "ActivitiesModule",
      "ActivityGeneration",
    );
    const revision = async () =>
      ((await (await client.get(endpoint)).json()) as { draft: { contentRevision: string } }).draft
        .contentRevision;
    const start = async () =>
      client.post(`${endpoint}/test`, {
        agentId: "default_agent",
        expectedRevision: await revision(),
      });
    const report = async () => {
      const res = await client.get(`${endpoint}/test-report`);
      expect(res.status).toBe(200);
      return (await res.json()) as AcceptanceStateResponse;
    };
    const runs = async () =>
      ((await (await client.get(`${endpoint}/runs`)).json()) as { runs: ActivityRunSummary[] })
        .runs;
    const store = t.deps.tree.api<ActivityRuns>("ActivitiesModule", "ActivityRuns");
    /**
     * Starts a run and waits until it has been collected: once its fake agent has finished, or,
     * for tests an earlier run wrote, once the server has run them.
     */
    const runToEnd = async (next: Agent) => {
      agent = next;
      const response = await start();
      expect(response.status, await response.clone().text()).toBe(202);
      const run = (await response.json()) as ActivityRun;
      expect(run).toMatchObject({ kind: "test", status: "running" });
      if (run.sessionId) {
        await waitFor(() => t.deps.manager.statusOf(run.sessionId!) === "idle");
        await service.reconcile();
      }
      await waitFor(() => store.get(projectId, activityId, run.runId)?.status !== "running");
      const settled = (await runs()).find((entry) => entry.runId === run.runId)!;
      return { run, settled, workspace: path.join(t.root, "activity-runs", run.runId) };
    };
    const useAgent = (next: Agent) => {
      agent = next;
    };
    const useChecks = (next: typeof checks) => {
      checks = next;
    };
    return {
      t,
      client,
      endpoint,
      start,
      report,
      runs,
      runToEnd,
      prompts,
      seen,
      sessions,
      home,
      revision,
      useAgent,
      useChecks,
      checked,
      store,
      browserServers,
    };
  }

  it("finishes skipped without a Session when the specification has no criteria", async () => {
    const { t, start, report, sessions } = await setup({ criteria: [], installed: false });
    const response = await start();
    expect(response.status).toBe(202);
    const run = (await response.json()) as ActivityRun;
    expect(run).toMatchObject({ kind: "test", status: "succeeded", sessionId: null });
    expect(sessions).toEqual([]);
    const state = await report();
    expect(state).toMatchObject({
      runId: run.runId,
      criteria: 0,
      stale: false,
      browserInstalled: false,
    });
    expect(state.report).toMatchObject({
      overallStatus: "skipped",
      skippedReason: "no_criteria",
      results: [],
    });
    const stored = JSON.parse(
      await fs.readFile(
        path.join(t.root, "activity-runs", run.runId, "reports", "test.json"),
        "utf8",
      ),
    );
    expect(stored).toEqual(state.report);
  });

  it("refuses without the test browser or without an assembled module", async () => {
    const missing = await setup({ installed: false });
    expect(await missing.report()).toMatchObject({
      report: null,
      criteria: 2,
      browserInstalled: false,
    });
    const refused = await missing.start();
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "test_browser_missing" } });
    expect(missing.sessions).toEqual([]);

    const unbuilt = await setup({ built: false });
    const notBuilt = await unbuilt.start();
    expect(notBuilt.status).toBe(409);
    expect(await notBuilt.json()).toMatchObject({ error: { code: "preview_not_built" } });
    expect(unbuilt.sessions).toEqual([]);
  });

  it("stages the harness, collects results in the criteria's order, and fails a missing one not_run", async () => {
    const { report, runToEnd, prompts, seen, home } = await setup();
    const { run, settled, workspace } = await runToEnd(
      writesResults({
        results: [
          {
            criterion: CRITERIA[1],
            testName: "end screen",
            status: "failed",
            durationMs: 900,
            error: "Expected state end, saw intro.",
          },
        ],
      }),
    );
    expect(settled.status, settled.error ?? "").toBe("succeeded");
    expect(settled.test).toMatchObject({ criteria: CRITERIA, reused: false });

    // What the agent was given, before it wrote anything.
    expect(seen[0]).toEqual(
      expect.arrayContaining([
        "acceptance-input.json",
        "activity-harness.mjs",
        "run-acceptance.mjs",
        "package.json",
        "activity-spec.json",
      ]),
    );
    expect(seen[0]).not.toContain("acceptance.test.mjs");
    expect(prompts[0]).toContain(JSON.stringify(acceptancePrompt).slice(1, 60));
    const input = JSON.parse(
      await fs.readFile(path.join(workspace, "acceptance-input.json"), "utf8"),
    );
    expect(input).toMatchObject({
      criteria: CRITERIA,
      scenes: ["intro", "end"],
      viewport: { width: 640, height: 480 },
      browserPath: executableIn(home),
    });
    expect(input.playUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/preview\/activity\/.+\/play$/);
    expect(await fs.readFile(path.join(workspace, "activity-harness.mjs"), "utf8")).toBe(
      activityHarnessSource,
    );
    expect(await fs.readFile(path.join(workspace, "run-acceptance.mjs"), "utf8")).toBe(
      runAcceptanceSource,
    );
    const pkg = JSON.parse(await fs.readFile(path.join(workspace, "package.json"), "utf8"));
    expect(pkg.dependencies["playwright-core"]).toMatch(/^\d+\.\d+\.\d+/);

    const state = await report();
    expect(state.runId).toBe(run.runId);
    expect(state.report).toMatchObject({ overallStatus: "failed", reused: false });
    expect(state.report!.results).toEqual([
      {
        criterion: CRITERIA[0],
        testName: "",
        status: "failed",
        durationMs: 0,
        error: null,
        code: "not_run",
      },
      {
        criterion: CRITERIA[1],
        testName: "end screen",
        status: "failed",
        durationMs: 900,
        error: "Expected state end, saw intro.",
      },
    ]);
  });

  it("runs the tests for unchanged criteria itself, and has new ones written when they change", async () => {
    const f = await setup();
    const { client, endpoint, report, runToEnd, seen, sessions, checked } = f;
    const passing = {
      results: CRITERIA.map((criterion) => ({
        criterion,
        testName: criterion,
        status: "passed",
        durationMs: 10,
      })),
    };
    await runToEnd(writesResults(passing, "// written once\n"));
    expect(sessions).toHaveLength(1);

    // Unchanged criteria: the server runs the earlier test file itself. No agent is started,
    // so none can change what the checks rest on or write their results.
    f.useChecks(async () => ({ ran: true, results: JSON.stringify(passing) }));
    const second = await runToEnd(async () => {
      throw new Error("No agent runs the tests an earlier run wrote.");
    });
    expect(sessions).toHaveLength(1);
    expect(second.run).toMatchObject({ sessionId: null, agentId: "" });
    expect(second.settled).toMatchObject({ status: "succeeded", sessionId: null, agentId: "" });
    expect(second.settled.test).toMatchObject({
      reused: true,
      cachedTestHash: createHash("sha256").update("// written once\n").digest("hex"),
    });
    // It ran the earlier file against the play link the run staged, with nothing of a
    // confined Session's: no browser server was started for it.
    expect(checked).toHaveLength(1);
    const staged = JSON.parse(
      await fs.readFile(path.join(second.workspace, "acceptance-input.json"), "utf8"),
    );
    expect(staged.browserEndpoint).toBeUndefined();
    expect(checked[0]).toMatchObject({ test: "// written once\n", input: staged });
    expect(checked[0]!.signal.aborted).toBe(false);
    expect(f.browserServers).toHaveLength(1);
    // The folder holds what ran and what it found, as a Session's would.
    expect(await fs.readFile(path.join(second.workspace, "acceptance.test.mjs"), "utf8")).toBe(
      "// written once\n",
    );
    expect(
      JSON.parse(await fs.readFile(path.join(second.workspace, "acceptance-results.json"), "utf8")),
    ).toEqual(passing);
    const reused = JSON.parse(
      await fs.readFile(path.join(second.workspace, "reports", "test.json"), "utf8"),
    );
    expect(reused).toMatchObject({ overallStatus: "passed", reused: true });
    expect(reused.untrusted).toBeUndefined();
    expect((await report()).runId).toBe(second.run.runId);
    expect((await report()).stale).toBe(false);

    // A changed criterion: the tests are written again.
    const detail = (await (await client.get(endpoint)).json()) as {
      draft: { contentRevision: string; spec: Record<string, unknown> };
    };
    const saved = await client.post(`${endpoint}/apply-generated-spec`, {
      spec: { ...detail.draft.spec, acceptance_criterias: [...CRITERIA, "It ends."] },
      expectedRevision: detail.draft.contentRevision,
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    // The report now tested an earlier specification.
    expect((await report()).stale).toBe(true);
    const third = await runToEnd(writesResults(passing));
    expect(sessions).toHaveLength(2);
    expect(seen[1]).not.toContain("acceptance.test.mjs");
    expect(third.settled.test).toMatchObject({ reused: false });
    expect(third.settled.agentId).toBe("default_agent");
    expect((await report()).stale).toBe(false);
  });

  it("fails a run whose earlier tests could not run, and keeps the report it had", async () => {
    const f = await setup();
    const passing = {
      results: CRITERIA.map((criterion) => ({ criterion, status: "passed", durationMs: 4 })),
    };
    const first = await f.runToEnd(writesResults(passing));
    f.useChecks(async () => ({
      ran: false,
      reason: "The test browser did not start: no display.",
    }));
    const second = await f.runToEnd(async () => {});
    expect(second.settled).toMatchObject({
      status: "failed",
      error: "The test browser did not start: no display.",
    });
    expect(f.sessions).toHaveLength(1);
    const state = await f.report();
    expect(state.runId).toBe(first.run.runId);
    expect(state.report).toMatchObject({ overallStatus: "passed" });
  });

  it("runs the tests again for the Stages as the server's own work, and hands back how it ended", async () => {
    const f = await setup();
    await f.runToEnd(writesResults({ results: [] }, "// the first tests\n"));
    const api = <T>(name: string) => f.t.deps.tree.api<T>("ActivitiesModule", name);
    const acceptance = api<ActivityAcceptance>("ActivityAcceptance");
    const generation = api<ActivityGenerationService>("ActivityGeneration");
    const projectId = "tests_owner-tests";
    const activityId = f.endpoint.split("/").at(-1)!;
    // What the Stages' repair round asks for after a repair: the tests the first run wrote.
    const request = await acceptance.testRun(projectId, activityId);
    expect(request?.test.cachedTest).toBe("// the first tests\n");
    const failing = {
      results: [{ criterion: CRITERIA[0], status: "failed", durationMs: 3, error: "Saw intro." }],
    };
    f.useChecks(async () => ({ ran: true, results: JSON.stringify(failing) }));
    const outcome = await generation.runAndAccept(projectId, activityId, request!, {
      agentId: "default_agent",
    });
    expect(outcome).toMatchObject({
      outcome: "succeeded",
      run: { kind: "test", status: "succeeded", sessionId: null, agentId: "" },
    });
    expect(f.sessions).toHaveLength(1);
    const state = await f.report();
    expect(state.runId).toBe(outcome.outcome === "succeeded" ? outcome.run.runId : null);
    expect(state.report).toMatchObject({ overallStatus: "failed", reused: true });
    expect(state.report?.untrusted).toBeUndefined();
  });

  it("keeps what it staged in the run's record before the server runs earlier tests", async () => {
    const f = await setup();
    await f.runToEnd(writesResults({ results: [] }));
    const recorded: (Record<string, string> | undefined)[] = [];
    f.useChecks(async () => {
      // The record as it is stored when the checks start.
      recorded.push(...f.store.running().map((run) => run.test?.staged));
      return { ran: true, results: JSON.stringify({ results: [] }) };
    });
    const { settled } = await f.runToEnd(async () => {});
    expect(settled.status, settled.error ?? "").toBe("succeeded");
    expect(Object.keys(recorded[0] ?? {}).sort()).toEqual([
      "acceptance-input.json",
      "activity-harness.mjs",
      "package.json",
      "run-acceptance.mjs",
    ]);
  });

  it("stops the server's run of earlier tests when the run is cancelled", async () => {
    const f = await setup();
    await f.runToEnd(writesResults({ results: [] }));
    let stopped = false;
    f.useChecks(
      (request) =>
        new Promise<ChecksOutcome>((resolve) => {
          request.signal.addEventListener("abort", () => {
            stopped = true;
            resolve({ ran: false, reason: "The acceptance tests were stopped." });
          });
        }),
    );
    const response = await f.start();
    expect(response.status).toBe(202);
    const run = (await response.json()) as ActivityRun;
    await waitFor(() => f.checked.length === 1);
    const cancelled = await f.client.post(`${f.endpoint}/runs/${run.runId}/cancel`, {});
    expect(cancelled.status).toBe(200);
    await waitFor(() => stopped);
    const settled = (await f.runs()).find((entry) => entry.runId === run.runId)!;
    expect(settled.status).toBe("cancelled");
  });

  it("fails the run with a worded error when the results file is malformed or too large", async () => {
    const { report, runToEnd } = await setup();
    const malformed = await runToEnd(writesResults("{ not json"));
    expect(malformed.settled.status).toBe("failed");
    expect(malformed.settled.error).toBe("acceptance-results.json is not valid JSON.");

    const wrong = await runToEnd(writesResults({ results: [{ criterion: "x", status: "ok" }] }));
    expect(wrong.settled.status).toBe("failed");
    expect(wrong.settled.error).toMatch(/status other than passed, failed or skipped/);

    const huge = await runToEnd(writesResults("x".repeat(1024 * 1024 + 1)));
    expect(huge.settled.status).toBe("failed");
    expect(huge.settled.error).toMatch(/no larger than 1048576 bytes/);

    const nothing = await runToEnd(async () => {});
    expect(nothing.settled.status).toBe("failed");
    expect(nothing.settled.error).toBe("The session ended without acceptance-results.json.");
    expect((await report()).report).toBeNull();
  });

  it("keeps what it staged in the run's record before the run's Session starts", async () => {
    const f = await setup();
    const store = f.t.deps.tree.api<ActivityRuns>("ActivitiesModule", "ActivityRuns");
    const startTask = f.t.deps.manager.startTask.bind(f.t.deps.manager);
    const recorded: (Record<string, string> | undefined)[] = [];
    vi.spyOn(f.t.deps.manager, "startTask").mockImplementation(async (...args) => {
      // The record as it is stored when the agent is set to work.
      recorded.push(...store.running().map((run) => run.test?.staged));
      return startTask(...args);
    });
    await f.runToEnd(writesResults({ results: [] }));
    expect(recorded).toHaveLength(1);
    expect(Object.keys(recorded[0] ?? {}).sort()).toEqual([
      "acceptance-input.json",
      "activity-harness.mjs",
      "package.json",
      "run-acceptance.mjs",
    ]);
  });

  it("marks a report untrusted when its run changed the harness its checks rest on", async () => {
    const f = await setup();
    const passing = {
      results: CRITERIA.map((criterion) => ({ criterion, status: "passed", durationMs: 4 })),
    };
    // An empty test file is none to reuse: the next run is an agent's too.
    await f.runToEnd(writesResults(passing, ""));
    expect((await f.report()).report).toMatchObject({ overallStatus: "passed" });
    expect((await f.report()).report?.untrusted).toBeUndefined();
    await f.runToEnd(async (workspace) => {
      await fs.appendFile(
        path.join(workspace, "activity-harness.mjs"),
        "\n// every check passes\n",
      );
      await writesResults(passing)(workspace);
    });
    expect((await f.report()).report).toMatchObject({ overallStatus: "passed", untrusted: true });
  });

  it("records the module build each test run plays, and plays the build it is named", async () => {
    const f = await setup();
    const api = <T>(name: string) => f.t.deps.tree.api<T>("ActivitiesModule", name);
    const store = api<ActivityRuns>("ActivityRuns");
    const acceptance = api<ActivityAcceptance>("ActivityAcceptance");
    const projectId = "tests_owner-tests";
    const activityId = f.endpoint.split("/").at(-1)!;
    const playedRun = (playUrl: string) => {
      return readPlayKey(new URL(playUrl).pathname.split("/")[3]!)?.runId;
    };
    // The module in the WAF checkout is no build of the activity's: none is recorded.
    const checkout = await f.runToEnd(writesResults({ results: [] }));
    expect(checkout.settled.test?.moduleRunId).toBeUndefined();

    // A build of the activity's, as an assembly leaves it: the preview plays it, and so do the
    // tests, which record it.
    const draft = (await (await f.client.get(f.endpoint)).json()) as ActivityDetail;
    const now = new Date().toISOString();
    const build = {
      kind: "module",
      runId: newId("run"),
      activityId,
      projectId,
      draftId: draft.draft.draftId,
      inputRevision: draft.draft.contentRevision,
      agentId: "default_agent",
      sessionId: null,
      status: "running",
      createdAt: now,
      finishedAt: null,
      error: null,
      candidate: null,
    } as ActivityRun;
    store.open(build);
    store.save({ ...build, status: "succeeded", finishedAt: now });
    await write(path.join(store.workspace(build.runId), "module", "definition.json"), {
      id: "sightWords",
    });
    const playing = await f.runToEnd(writesResults({ results: [] }));
    expect(playing.settled.test?.moduleRunId).toBe(build.runId);
    const input = JSON.parse(
      await fs.readFile(path.join(playing.workspace, "acceptance-input.json"), "utf8"),
    ) as { playUrl: string };
    expect(playedRun(input.playUrl)).toBe(build.runId);

    // Named, it plays that build behind a link of its own.
    const named = await acceptance.testRun(projectId, activityId, build.runId);
    expect(named?.test.moduleRunId).toBe(build.runId);
    expect(playedRun(named!.test.input.playUrl)).toBe(build.runId);
    // Anything but a module build of the activity that succeeded is refused.
    await expect(
      acceptance.testRun(projectId, activityId, playing.run.runId),
    ).rejects.toMatchObject({ code: "module_build_missing" });
    await expect(acceptance.testRun(projectId, activityId, newId("run"))).rejects.toMatchObject({
      code: "module_build_missing",
    });
  });

  it("gives a module run a player check over a link that plays the run's own module", async () => {
    const assemble = async (f: Awaited<ReturnType<typeof setup>>) => {
      await f.client.patch(`${f.endpoint}/description`, {
        description: "Tap the cat, then celebrate.",
        expectedRevision: await f.revision(),
      });
      const applied = await f.client.post(`${f.endpoint}/apply-generated-spec`, {
        spec: { ...activitySpec, acceptance_criterias: CRITERIA },
        expectedRevision: await f.revision(),
      });
      expect(applied.status, await applied.clone().text()).toBe(200);
      const response = await f.client.post(`${f.endpoint}/assemble-module`, {
        agentId: "default_agent",
        expectedRevision: await f.revision(),
      });
      expect(response.status, await response.clone().text()).toBe(202);
      const run = (await response.json()) as ActivityRun;
      await waitFor(() => f.t.deps.manager.statusOf(run.sessionId!) === "idle");
      return run;
    };

    const f = await setup();
    let played: { status: number; body: string } | null = null;
    f.useAgent(async (workspace) => {
      const input = JSON.parse(
        await fs.readFile(path.join(workspace, PLAYER_CHECK_DIR, "acceptance-input.json"), "utf8"),
      ) as { playUrl: string };
      // While the run is still going, its link serves the module in its own workspace.
      const url = new URL("module/definition.json", input.playUrl);
      const response = await f.t.app.request(url.toString(), { headers: { host: url.host } });
      played = { status: response.status, body: await response.text() };
    });
    const run = await assemble(f);
    const workspace = path.join(f.t.root, "activity-runs", run.runId);
    const check = path.join(workspace, PLAYER_CHECK_DIR);
    expect((await fs.readdir(check)).sort()).toEqual([
      "acceptance-input.json",
      "activity-harness.mjs",
      "package.json",
      "run-acceptance.mjs",
    ]);
    const input = JSON.parse(await fs.readFile(path.join(check, "acceptance-input.json"), "utf8"));
    expect(input).toMatchObject({
      criteria: CRITERIA,
      scenes: activitySpec.scenes.map((scene) => scene.id),
      browserPath: executableIn(f.home),
    });
    expect(readPlayKey(new URL(input.playUrl).pathname.split("/")[3]!)).toMatchObject({
      runId: run.runId,
    });
    expect(await fs.readFile(path.join(check, "activity-harness.mjs"), "utf8")).toBe(
      activityHarnessSource,
    );
    expect(played).not.toBeNull();
    expect(played!.status).toBe(200);
    expect(played!.body).toBe(
      await fs.readFile(path.join(workspace, "module", "definition.json"), "utf8"),
    );
    expect(f.prompts.at(-1)).toContain(PLAYER_CHECK_DIR);
    expect(f.prompts.at(-1)).not.toContain("preview/runtime.js");
    expect(f.prompts.at(-1)).not.toContain("native reader");

    // Without the test browser there is nothing to check with, and nothing is staged.
    const bare = await setup({ installed: false });
    bare.useAgent(async () => {});
    const unchecked = await assemble(bare);
    const files = await fs.readdir(path.join(bare.t.root, "activity-runs", unchecked.runId));
    expect(files).not.toContain(PLAYER_CHECK_DIR);
  });

  it("records a module run's player check as staged, and marks it untrusted when the run changed it", async () => {
    const f = await setup();
    await f.client.patch(`${f.endpoint}/description`, {
      description: "Tap the cat, then celebrate.",
      expectedRevision: await f.revision(),
    });
    const applied = await f.client.post(`${f.endpoint}/apply-generated-spec`, {
      spec: { ...activitySpec, acceptance_criterias: CRITERIA },
      expectedRevision: await f.revision(),
    });
    expect(applied.status, await applied.clone().text()).toBe(200);
    const service = f.t.deps.tree.api<ActivityGenerationService>(
      "ActivitiesModule",
      "ActivityGeneration",
    );
    const projectId = "tests_owner-tests";
    const activityId = f.endpoint.split("/").at(-1)!;
    /** Assembles with the agent given, and answers the run's record once it is collected. */
    const assemble = async (agent: Agent) => {
      f.useAgent(agent);
      const response = await f.client.post(`${f.endpoint}/assemble-module`, {
        agentId: "default_agent",
        expectedRevision: await f.revision(),
      });
      expect(response.status, await response.clone().text()).toBe(202);
      const run = (await response.json()) as ActivityRun;
      await waitFor(() => f.t.deps.manager.statusOf(run.sessionId!) === "idle");
      await service.reconcile();
      await waitFor(() => f.store.get(projectId, activityId, run.runId)?.status !== "running");
      return f.store.get(projectId, activityId, run.runId)!;
    };
    const results = async (workspace: string) =>
      fs.writeFile(
        path.join(workspace, PLAYER_CHECK_DIR, "acceptance-results.json"),
        JSON.stringify({ results: [] }),
      );

    const clean = await assemble(results);
    expect(Object.keys(clean.playerCheck?.staged ?? {}).sort()).toEqual([
      "acceptance-input.json",
      "activity-harness.mjs",
      "package.json",
      "run-acceptance.mjs",
    ]);
    expect(clean.playerCheck?.untrusted).toBeUndefined();

    // Whether the run then succeeds or not, a check that rests on a changed runner is untrusted.
    const tampered = await assemble(async (workspace) => {
      await fs.appendFile(
        path.join(workspace, PLAYER_CHECK_DIR, "run-acceptance.mjs"),
        "\n// every check passes\n",
      );
      await results(workspace);
    });
    expect(tampered.playerCheck).toMatchObject({ untrusted: true });
    // The record keeps the runner as it was staged, not as the run left it.
    expect(tampered.playerCheck?.staged["run-acceptance.mjs"]).toBe(
      clean.playerCheck?.staged["run-acceptance.mjs"],
    );
  });

  it("connects a confined run's checks to a browser the server started, and stops it after", async () => {
    const { runToEnd, browserServers } = await setup();
    let input: { browserEndpoint?: string } = {};
    const { settled } = await runToEnd(async (workspace) => {
      input = JSON.parse(await fs.readFile(path.join(workspace, "acceptance-input.json"), "utf8"));
      await writesResults({ results: [] })(workspace);
    });
    expect(settled.status).not.toBe("running");
    expect(browserServers).toHaveLength(1);
    expect(input.browserEndpoint).toBe(browserServers[0]!.endpoint);
    expect(browserServers[0]!.closed).toBe(true);
    // The staged runner connects when it is given an address, and starts the browser otherwise.
    expect(runAcceptanceSource).toContain("chromium.connect(input.browserEndpoint)");
    expect(runAcceptanceSource).toContain("chromium.launch(");
  });

  it("hands a confined run no host browser when the deployment hides paths from commands", async () => {
    // A backend covering masking too, so the run is confined rather than refused.
    const sandbox = new SandboxService([
      [
        "stand-in",
        {
          dimensions: ["fs-write", "mask-paths"],
          confine: (argv) => ({
            argv: [...argv],
            enforcement: "full",
            denialSignatures: [],
            runnerFailureRules: [],
          }),
        },
      ],
    ]);
    sandbox.configure({ mode: "danger-full-access", maskPaths: ["/secrets"] });
    const { runToEnd, browserServers } = await setup({ sandbox });
    let input: { browserEndpoint?: string } = {};
    await runToEnd(async (workspace) => {
      input = JSON.parse(await fs.readFile(path.join(workspace, "acceptance-input.json"), "utf8"));
      await writesResults({ results: [] })(workspace);
    });
    // The browser runs outside the sandbox and could open the hidden files.
    expect(browserServers).toEqual([]);
    expect(input.browserEndpoint).toBeUndefined();
  });
});
