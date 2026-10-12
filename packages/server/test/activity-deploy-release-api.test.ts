/**
 * The module release routes: the stage list and why each stage cannot run, starting the release
 * or one stage (the owner's), one deploy at a time, the log after a cursor, and Stop.
 *
 * git, npm, Jenkins and the clock are fakes behind the deploy ports: nothing here reaches a
 * network, a real remote or a real program. The clones are the WAF checkout's: its
 * activity-data, media and module repositories are there already.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityDetail } from "../src/activities/domain.js";
import type { JenkinsFetch } from "../src/activities/deploy-jenkins.js";
import type { DeployProcess, DeployProcessResult } from "../src/activities/deploy-process.js";
import type {
  DeployLogResponse,
  DeployRunResponse,
  DeployStateResponse,
} from "../src/activities/deploy-types.js";
import { activitySpec } from "./activity-fixtures.js";
import { FakeClones } from "./fake-clones.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";

const PROJECT = "releaser-work";
const DATA_REMOTE = "git@github.com:org/data.git";
const MEDIA_REMOTE = "git@github.com:org/media.git";
const QA_TOKEN = "qa-secret-token";

/**
 * The checkout's clones, answering from memory: the module's tags gain a newer release after
 * its first fetch, and the media repository holds `tracked`.
 */
function moduleRepos(clones: FakeClones, root: string, tracked: string[] = []) {
  clones.repo(path.join(root, "modules", "waf-module-words"))!.tags = [
    ["1.4.0"],
    ["1.4.0", "1.5.0"],
  ];
  clones.repo(path.join(root, "media"))!.inHead = tracked;
  for (const dir of ["modules/waf-module-words", "waf-activity-data", "media"])
    clones.repo(path.join(root, dir))!.head = "c0ffee";
}

/** Jenkins: the job has no build until it is started, then one that succeeded. */
function fakeJenkins() {
  const calls: Array<{ url: string; method: string; body?: string; auth?: string }> = [];
  let started = false;
  const respond = (status: number, body: unknown = "") => ({
    status,
    headers: { get: () => null },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  });
  const request: JenkinsFetch = async (url, init) => {
    calls.push({
      url,
      method: init.method,
      ...(init.body ? { body: init.body } : {}),
      ...(init.headers.Authorization ? { auth: init.headers.Authorization } : {}),
    });
    if (url.endsWith("/buildWithParameters")) {
      started = true;
      return respond(201);
    }
    if (url.includes("/queue/api/json")) return respond(200, { items: [] });
    return respond(200, {
      builds: started
        ? [
            {
              number: 3,
              url: "job/Build%20WAF%20Modules/3/",
              building: false,
              result: "SUCCESS",
              actions: [{ parameters: [{ name: "Modules", value: "words loom/words-deploy" }] }],
            },
          ]
        : [],
    });
  };
  return { calls, request };
}

/**
 * npm that passes at once, or (hanging) runs until Stop and counts the kills; lint fails while
 * `failLint` is set.
 */
function fakeProcess(options: { hang?: boolean; failLint?: boolean } = {}) {
  const state = { lines: [] as string[], killed: 0, failLint: options.failLint ?? false };
  const run: DeployProcess["run"] = (command, args, opts) => {
    const line = `${command} ${args.join(" ")}`;
    state.lines.push(line);
    opts.onOutput?.(`${line}: done\n`);
    if (state.failLint && line === "npm run lint")
      return Promise.resolve({ code: 1, tail: "error  'x' is never used" });
    if (!options.hang) return Promise.resolve({ code: 0, tail: "" });
    return new Promise<DeployProcessResult>((resolve) =>
      opts.signal?.addEventListener("abort", () => {
        state.killed++;
        resolve({ code: null, tail: "", error: "stopped" });
      }),
    );
  };
  return { state, run };
}

describe("activity deploy release routes", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function setup(processOptions: { hang?: boolean; failLint?: boolean } = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-release-waf-"));
    cleanups.push(() => fs.rm(root, { recursive: true, force: true }));
    await fs.mkdir(path.join(root, "framework", "src"), { recursive: true });
    await fs.writeFile(path.join(root, "framework", "package.json"), "{}");
    await fs.mkdir(path.join(root, "modules"), { recursive: true });
    const clones = new FakeClones();
    // The checkout's clones, the product's module among them (its owner cloned it, and
    // Penguin writes the product's files into it); its media's sparse set has this
    // product's folder.
    for (const [folder, remote] of [
      ["waf-activity-data", DATA_REMOTE],
      ["media", MEDIA_REMOTE],
      ["modules/waf-module-words", "git@github.com:org/waf-module-words.git"],
    ] as const)
      await clones.onDisk(path.join(root, folder), {
        origin: remote,
        ...(folder === "media" ? { sparse: ["loom/words"] } : {}),
      });
    await fs.writeFile(
      path.join(root, "modules", "waf-module-words", "package.json"),
      JSON.stringify({ name: "waf-module-words", version: "1.0.0" }),
    );
    vi.stubEnv("WAF_ROOT_DIR", root);

    moduleRepos(clones, root);
    const git = clones;
    const jenkins = fakeJenkins();
    const npm = fakeProcess(processOptions);
    const t = await createTestApp({
      deployPorts: {
        clones,
        jenkinsFetch: jenkins.request,
        runProcess: npm.run,
        now: () => 0,
        sleep: async () => {},
      },
      wafWorkspacePorts: { clones },
    });
    cleanups.push(async () => {
      await t.cleanup();
    });
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const owner = await provisionUser(t.app, "releaser");
    const client = apiClient(t.app, owner.cookie);
    expect((await client.post("/api/projects", { projectId: PROJECT })).status).toBe(201);
    const base = `/api/projects/${PROJECT}/activities`;
    const activity = (await (
      await client.post(base, { productCode: "words", refNum: 1, title: "Words" })
    ).json()) as ActivityDetail;
    expect(
      (
        await client.post(`${base}/${activity.id}/apply-generated-spec`, {
          expectedRevision: activity.draft.contentRevision,
          spec: { ...activitySpec, moduleFolder: "waf-module-words" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await admin.put("/api/admin/activity-deploy/settings", {
          qa: {
            jenkinsUrl: "https://jenkins.example.org",
            username: "robot",
            token: QA_TOKEN,
            frameworkVersion: "4.2.1",
            activityBaseUrl: "https://qa.example.org",
          },
          git: { userName: "Deploy", userEmail: "deploy@example.org" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await admin.put("/api/admin/waf-workspace/settings", {
          repos: { activityData: { remote: DATA_REMOTE }, media: { remote: MEDIA_REMOTE } },
          moduleRemote: "git@github.com:org/{module}.git",
        })
      ).status,
    ).toBe(200);
    const endpoint = `${base}/${activity.id}`;
    expect((await client.post(`${endpoint}/deploy/clones`)).status).toBe(200);
    const state = async () => {
      const res = await client.get(`${endpoint}/deploy`);
      expect(res.status).toBe(200);
      return (await res.json()) as DeployStateResponse;
    };
    return { t, root, git, jenkins, npm, client, base, endpoint, state };
  }

  it("lists the ten stages, pending, with the later ones waiting on the one before", async () => {
    const { state } = await setup();
    const found = await state();
    expect(found.context.ready).toBe(true);
    expect(found.run).toBeNull();
    expect(found.stages.map((stage) => [stage.stage, stage.status, stage.blocker])).toEqual([
      ["verify_module", "pending", null],
      ["prepare_deploy", "pending", { code: "previous_stage", stage: "verify_module" }],
      ["trigger_module_build", "pending", { code: "previous_stage", stage: "prepare_deploy" }],
      ["await_module_build", "pending", { code: "previous_stage", stage: "trigger_module_build" }],
      ["export_activity_data", "pending", { code: "previous_stage", stage: "await_module_build" }],
      [
        "verify_activity_data",
        "pending",
        { code: "previous_stage", stage: "export_activity_data" },
      ],
      ["verify_media_assets", "pending", { code: "previous_stage", stage: "verify_activity_data" }],
      [
        "publish_activity_data",
        "pending",
        { code: "previous_stage", stage: "verify_media_assets" },
      ],
      [
        "trigger_activity_deploy",
        "pending",
        { code: "previous_stage", stage: "publish_activity_data" },
      ],
      [
        "await_activity_deploy",
        "pending",
        { code: "previous_stage", stage: "trigger_activity_deploy" },
      ],
    ]);
  });

  it("refuses a stage before the one it needs, a bad request, and a ref that is not canonical", async () => {
    const { client, base, endpoint, jenkins } = await setup();
    const early = await client.post(`${endpoint}/deploy`, { stage: "trigger_module_build" });
    expect(early.status).toBe(409);
    expect(await early.json()).toMatchObject({
      error: {
        code: "deploy_blocked",
        detail: {
          stage: "trigger_module_build",
          blocker: "previous_stage",
          previous: "prepare_deploy",
        },
      },
    });
    expect((await client.post(`${endpoint}/deploy`, { stage: "deploy_everything" })).status).toBe(
      400,
    );
    expect(
      (await client.post(`${endpoint}/deploy`, { stage: "release", moduleVersion: "v1.2" })).status,
    ).toBe(400);
    const second = (await (
      await client.post(base, { productCode: "words", refNum: 2, title: "Words 2" })
    ).json()) as ActivityDetail;
    const other = await client.post(`${base}/${second.id}/deploy`, { stage: "release" });
    expect(other.status).toBe(409);
    expect(await other.json()).toMatchObject({ error: { code: "deploy_not_canonical" } });
    expect(jenkins.calls).toEqual([]);
  });

  it("releases the module: four stages, the resolved version, and a log read after a cursor", async () => {
    const { root, client, endpoint, state, git, jenkins, npm } = await setup();
    const res = await client.post(`${endpoint}/deploy`, {
      stage: "release",
      moduleVersion: "1.5.0",
    });
    expect(res.status).toBe(202);
    const { run } = (await res.json()) as DeployRunResponse;
    await vi.waitFor(async () => expect((await state()).run?.status).toBe("succeeded"));
    const found = await state();
    expect(found.run!.metadata).toMatchObject({
      moduleVersion: "1.5.0",
      preBuildTag: "1.4.0",
      preBuildNumber: null,
      resolvedModuleVersion: "1.5.0",
      moduleBuildUrl: "https://jenkins.example.org/job/Build%20WAF%20Modules/3/",
    });
    expect(found.stages.map((stage) => stage.status)).toEqual([
      "done",
      "done",
      "done",
      "done",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
    expect(npm.state.lines).toEqual([
      "npm ci",
      "npm run buildDebug",
      "npm run lint",
      "npm run buildRelease",
    ]);
    const trigger = jenkins.calls.find((call) => call.url.endsWith("/buildWithParameters"))!;
    expect(trigger.body).toBe("Modules=words+loom%2Fwords-deploy");
    expect(trigger.auth).toBe(`Basic ${Buffer.from(`robot:${QA_TOKEN}`).toString("base64")}`);
    // The release ran in the module's clone, where the checkout keeps modules.
    const clone = path.join(root, "modules", "waf-module-words");
    expect(git.ops(clone)).toContain("push");
    expect(JSON.parse(await fs.readFile(path.join(clone, "package.json"), "utf8"))).toMatchObject({
      name: "wafmodule-words",
      version: "1.5.0",
    });

    const page = async (after: number) => {
      const got = await client.get(`${endpoint}/deploy/runs/${run.runId}/log?after=${after}`);
      expect(got.status).toBe(200);
      const text = await got.text();
      expect(text).not.toContain(QA_TOKEN);
      return (JSON.parse(text) as DeployLogResponse).log;
    };
    const first = await page(0);
    expect(first.lines[0]!.text).toBe("== verify_module");
    expect(first.done).toBe(true);
    const cut = first.lines[4]!.seq;
    const rest = await page(cut);
    expect(rest.lines.map((line) => line.seq)).toEqual(
      first.lines.slice(5).map((line) => line.seq),
    );
    expect((await client.get(`${endpoint}/deploy/runs/${run.runId}/log?after=x`)).status).toBe(400);
    expect((await client.get(`${endpoint}/deploy/runs/dep_missing/log`)).status).toBe(404);

    // Now the trigger stage may run on its own; it sets the wait back to pending.
    const again = await client.post(`${endpoint}/deploy`, { stage: "trigger_module_build" });
    expect(again.status).toBe(202);
    await vi.waitFor(async () => expect((await state()).run?.status).toBe("succeeded"));
  });

  it("starts again after a failed verify left work in the clone, commits it, and prepares once per verify", async () => {
    const { client, endpoint, state, git, npm, root } = await setup({ failLint: true });
    expect((await client.post(`${endpoint}/deploy`, { stage: "release" })).status).toBe(202);
    await vi.waitFor(async () => expect((await state()).run?.status).toBe("failed"));
    // The copied files are still in the clone: the module clone holds authored work, so
    // readiness does not count that against it, and nothing is blocked by it.
    const module = git.repo(path.join(root, "modules", "waf-module-words"))!;
    module.dirty = true;
    const failed = await state();
    expect(failed.context.problems).not.toContainEqual({ code: "clone_dirty", repo: "module" });
    expect(failed.stages[0]).toMatchObject({
      stage: "verify_module",
      status: "failed",
      blocker: null,
    });
    expect(failed.run!.stages[0]!.error).toMatchObject({
      code: "command_failed",
      command: "npm run lint",
    });

    npm.state.failLint = false;
    expect((await client.post(`${endpoint}/deploy`, { stage: "release" })).status).toBe(202);
    await vi.waitFor(async () => expect((await state()).run?.status).toBe("succeeded"));
    expect(module.dirty).toBe(false);
    const moduleCalls = git.calls.filter((call) => call.dir.includes("modules"));
    // The work was carried onto main and committed there, never reset or cleaned away.
    expect(moduleCalls).toContainEqual(
      expect.objectContaining({ op: "onBranchFromOrigin", args: ["main", { work: "carry" }] }),
    );
    expect(moduleCalls).toContainEqual(
      expect.objectContaining({
        op: "commitStaged",
        args: ["Penguin Harness: words as authored", expect.anything()],
      }),
    );
    expect(
      moduleCalls.some(
        (call) =>
          call.op === "onBranchFromOrigin" && (call.args[1] as { work: string }).work === "discard",
      ),
    ).toBe(false);

    // Prepare works on what verify leaves; run on its own again it would drop that content.
    const again = await client.post(`${endpoint}/deploy`, { stage: "prepare_deploy" });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({
      error: {
        code: "deploy_blocked",
        detail: { stage: "prepare_deploy", blocker: "previous_rerun", previous: "verify_module" },
      },
    });
    expect((await state()).stages[1]!.blocker).toEqual({
      code: "previous_rerun",
      stage: "verify_module",
    });
  });

  it("runs one deploy at a time and Stop cancels it; a member reads but cannot start or stop", async () => {
    const { t, client, endpoint, npm, state } = await setup({ hang: true });
    const res = await client.post(`${endpoint}/deploy`, { stage: "release" });
    expect(res.status).toBe(202);
    await vi.waitFor(() => expect(npm.state.lines).toEqual(["npm ci"]));
    const second = await client.post(`${endpoint}/deploy`, { stage: "verify_module" });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: { code: "deploy_running" } });
    const running = await state();
    expect(running.run?.status).toBe("running");
    expect(running.stages.every((stage) => stage.blocker?.code === "run_active")).toBe(true);

    const member = await provisionUser(t.app, "release_reader");
    expect(
      (await client.post(`/api/projects/${PROJECT}/members`, { userId: "release_reader" })).status,
    ).toBe(201);
    const reader = apiClient(t.app, member.cookie);
    expect((await reader.get(`${endpoint}/deploy`)).status).toBe(200);
    expect((await reader.post(`${endpoint}/deploy`, { stage: "release" })).status).toBe(403);
    expect((await reader.post(`${endpoint}/deploy/stop`)).status).toBe(403);

    const stopped = await client.post(`${endpoint}/deploy/stop`);
    expect(stopped.status).toBe(200);
    expect(((await stopped.json()) as DeployRunResponse).run.status).toBe("cancelled");
    expect(npm.state.killed).toBe(1);
    expect((await state()).stages[0]!.status).toBe("cancelled");
  });
});
