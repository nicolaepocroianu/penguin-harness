/**
 * An activity run's own agent works confined to the run's workspace: the WAF checkout is
 * read-only to its commands by enforcement, not by the prompt's word. Where nothing can
 * confine them the run is refused before it starts. A coding agent runs its commands
 * itself, outside Penguin's sandbox, so it is not confined, and refused only for a module run,
 * whose module the server builds confined. A media run, which no agent works on, is neither
 * confined nor refused. Confined or not, a run's agent is not handed the API token or the
 * `penguin` CLI.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityDetail, ActivityDraft } from "../src/activities/domain.js";
import type { ActivityRuns } from "../src/activities/run-store.js";
import type { SessionEnv } from "../src/runtime/session-manager.js";
import { SandboxService } from "../src/sandbox/service.js";
import { activitySpec } from "./activity-fixtures.js";
import { fakeMediaHelper } from "./audio-fixtures.js";
import { apiClient, createTestApp, loginAdmin, provisionUser, type TestApp } from "./helpers.js";

const STAGE_AGENT = fileURLToPath(new URL("./coding-agents-stage-agent.mjs", import.meta.url));

describe("activity runs and the sandbox", () => {
  let t: TestApp;
  afterEach(async () => {
    vi.restoreAllMocks();
    await t.cleanup();
  });

  async function fixture(sandbox?: SandboxService) {
    // Media runs have no Session: the server runs their helper, which this fake stands in for.
    const helper = fakeMediaHelper();
    t = await createTestApp({ ...(sandbox ? { sandbox } : {}), mediaHelperPorts: helper.ports });
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    expect((await admin.post("/api/projects", { projectId: "confined" })).status).toBe(201);
    const base = "/api/projects/confined/activities";
    const activity = (await (
      await admin.post(base, { productCode: "p", refNum: 1, title: "One" })
    ).json()) as ActivityDetail;
    const endpoint = `${base}/${activity.id}`;
    const draft = (await (
      await admin.patch(`${endpoint}/description`, {
        description: "Teach sight words",
        expectedRevision: activity.draft.contentRevision,
      })
    ).json()) as ActivityDraft;
    // The Session itself is not the subject: record what it was asked for, and stop there.
    const createSession = vi
      .spyOn(t.deps.sessionService, "createSession")
      .mockRejectedValue(new Error("not under test"));
    const runs = async () =>
      ((await (await admin.get(`${endpoint}/runs`)).json()) as { runs: unknown[] }).runs;
    return { admin, endpoint, revision: draft.contentRevision, createSession, runs, helper };
  }

  it("creates the run's Session confined to its workspace", async () => {
    const f = await fixture();
    const response = await f.admin.post(`${f.endpoint}/generate-spec`, {
      agentId: "default_agent",
      expectedRevision: f.revision,
    });
    expect(response.status, await response.clone().text()).toBe(202);
    await vi.waitFor(() => expect(f.createSession).toHaveBeenCalled());
    expect(f.createSession.mock.calls[0]![0]).toMatchObject({ sandboxMode: "workspace-write" });
  });

  it("refuses to start a run nothing can confine, and records no run", async () => {
    const f = await fixture(new SandboxService([]));
    const response = await f.admin.post(`${f.endpoint}/generate-spec`, {
      agentId: "default_agent",
      expectedRevision: f.revision,
    });
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("sandbox_unavailable");
    expect(body.error.message).toMatch(/Enable a sandbox plugin for this project/);
    expect(f.createSession).not.toHaveBeenCalled();
    expect(await f.runs()).toEqual([]);
  });

  it("starts an image run nothing can confine, since no agent works on it", async () => {
    const f = await fixture(new SandboxService([]));
    // One image to make, its media planned, and the Media Agent's key.
    const applied = await f.admin.post(`${f.endpoint}/apply-generated-spec`, {
      spec: {
        ...activitySpec,
        scenes: [
          {
            id: "intro",
            description: "Look",
            media: { images: [{ key: "cover", description: "A blue penguin" }] },
          },
        ],
      },
      expectedRevision: f.revision,
    });
    expect(applied.status, await applied.clone().text()).toBe(200);
    const planned = await f.admin.post(`${f.endpoint}/plan-media`, {
      expectedRevision: ((await applied.json()) as ActivityDraft).contentRevision,
    });
    expect(planned.status, await planned.clone().text()).toBe(200);
    const vault = await f.admin.put("/api/projects/confined/agents/media_agent/vault", {
      entries: [{ key: "GEMINI_API_KEY", value: "fake-test-only" }],
    });
    expect(vault.status).toBe(200);
    const current = (await (await f.admin.get(f.endpoint)).json()) as ActivityDetail;
    const response = await f.admin.post(`${f.endpoint}/generate-image`, {
      agentId: "default_agent",
      expectedRevision: current.draft.contentRevision,
      language: "en-US",
      assetKey: "cover",
    });
    expect(response.status, await response.clone().text()).toBe(202);
    // The server runs the bundled helper itself: no Session, and nothing an agent wrote.
    await vi.waitFor(() => expect(f.helper.calls).toHaveLength(1));
    expect(f.helper.calls[0]).toMatchObject({ script: "generate-image.mjs" });
    expect(f.createSession).not.toHaveBeenCalled();
  });

  it("gives a confined Session's commands an npm cache inside its workspace", async () => {
    t = await createTestApp();
    const env = t.deps.tree.api<SessionEnv>("SessionRuntimeModule", "SessionEnv");
    const session = { projectId: "p", agentId: "a", sessionId: "s", workspaceDir: "/runs/r1" };
    expect(env.controlEnv({ ...session, sandboxMode: "workspace-write" })).toMatchObject({
      npm_config_cache: path.join("/runs/r1", ".npm-cache"),
    });
    expect(env.controlEnv(session)).not.toHaveProperty("npm_config_cache");
  });

  it("gives a run's Session no way to drive the server, and an ordinary Session its usual one", async () => {
    // A CLI entry to point the shim at, so an ordinary Session has one on its PATH.
    t = await createTestApp({ config: { cliEntry: fileURLToPath(import.meta.url) } });
    const env = t.deps.tree.api<SessionEnv>("SessionRuntimeModule", "SessionEnv");
    const runs = t.deps.tree.api<ActivityRuns>("ActivitiesModule", "ActivityRuns");
    const coordinates = { projectId: "p", agentId: "a", sessionId: "s" };
    const ordinary = { ...coordinates, workspaceDir: path.join(t.root, "workspaces", "w1") };
    // The run's own Session, and a subagent working in a folder of the run's.
    const run = { ...coordinates, workspaceDir: runs.workspace("run_1") };
    const nested = { ...coordinates, workspaceDir: path.join(runs.workspace("run_1"), "module") };

    expect(env.controlEnv(ordinary)).toMatchObject({
      PENGUIN_API_URL: expect.stringContaining(`:${t.deps.config.port}`),
      PENGUIN_API_TOKEN: t.deps.authService.localApiToken(),
      PENGUIN_SESSION_ID: "s",
    });
    expect(env.pathPrepend(ordinary)).toEqual([path.join(t.root, "bin")]);
    for (const session of [run, nested]) {
      const confined = { ...session, sandboxMode: "workspace-write" as const };
      for (const ctx of [session, confined]) {
        const vars = env.controlEnv(ctx);
        expect(vars).not.toHaveProperty("PENGUIN_API_URL");
        expect(vars).not.toHaveProperty("PENGUIN_API_TOKEN");
        // Only the means to reach the server are withheld; the Session's coordinates stay.
        expect(vars).toMatchObject({ PENGUIN_PROJECT_ID: "p", PENGUIN_SESSION_ID: "s" });
        expect(env.pathPrepend(ctx)).toEqual([]);
      }
    }
  });

  /** Registers the stage agent as a coding agent a run may name. */
  async function addCodingAgent(f: Awaited<ReturnType<typeof fixture>>) {
    const response = await f.admin.post("/api/coding-agents/agents", {
      id: "stage-agent",
      command: process.execPath,
      args: [STAGE_AGENT],
      env: {},
    });
    expect(response.status).toBe(201);
  }

  it("starts a coding agent's run without a sandbox, and does not hand it a floor", async () => {
    const f = await fixture(new SandboxService([]));
    await addCodingAgent(f);
    const response = await f.admin.post(`${f.endpoint}/generate-spec`, {
      codingAgentId: "stage-agent",
      expectedRevision: f.revision,
    });
    expect(response.status, await response.clone().text()).toBe(202);
    await vi.waitFor(() => expect(f.createSession).toHaveBeenCalled());
    expect(f.createSession.mock.calls[0]![0]).not.toHaveProperty("sandboxMode");
  });

  it("refuses a coding agent's module run nothing could confine the module's build of", async () => {
    const f = await fixture(new SandboxService([]));
    await addCodingAgent(f);
    const saved = await f.admin.post(`${f.endpoint}/apply-generated-spec`, {
      spec: activitySpec,
      expectedRevision: f.revision,
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    // Its player check plays a build of the module its agent writes, which this server makes.
    const response = await f.admin.post(`${f.endpoint}/assemble-module`, {
      codingAgentId: "stage-agent",
      expectedRevision: ((await saved.json()) as ActivityDraft).contentRevision,
    });
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("sandbox_unavailable");
    expect(f.createSession).not.toHaveBeenCalled();
    expect(await f.runs()).toEqual([]);
  });

  describe("the admin switch", () => {
    it("is on until an admin turns it off", async () => {
      const f = await fixture();
      const read = await f.admin.get("/api/admin/activity-sandbox");
      expect(read.status).toBe(200);
      expect(await read.json()).toEqual({ sandbox: { enabled: true, problem: null } });
    });

    it("off: a run starts without a sandbox, and its Session is not confined", async () => {
      const f = await fixture(new SandboxService([]));
      // With nothing to confine with, the switch reports why runs would be refused.
      const before = (await (await f.admin.get("/api/admin/activity-sandbox")).json()) as {
        sandbox: { problem: string | null };
      };
      expect(before.sandbox.problem).toMatch(/no sandbox backend is mounted/);
      const off = await f.admin.put("/api/admin/activity-sandbox", { enabled: false });
      expect(off.status).toBe(200);
      expect(((await off.json()) as { sandbox: { enabled: boolean } }).sandbox.enabled).toBe(false);
      const response = await f.admin.post(`${f.endpoint}/generate-spec`, {
        agentId: "default_agent",
        expectedRevision: f.revision,
      });
      expect(response.status, await response.clone().text()).toBe(202);
      await vi.waitFor(() => expect(f.createSession).toHaveBeenCalled());
      expect(f.createSession.mock.calls[0]![0]).not.toHaveProperty("sandboxMode");
    });

    it("is an admin's to change, and takes only a boolean", async () => {
      const f = await fixture();
      const member = apiClient(t.app, (await provisionUser(t.app, "sandbox_member")).cookie);
      expect((await member.get("/api/admin/activity-sandbox")).status).toBe(403);
      expect((await member.put("/api/admin/activity-sandbox", { enabled: false })).status).toBe(
        403,
      );
      expect((await f.admin.put("/api/admin/activity-sandbox", { enabled: "no" })).status).toBe(
        400,
      );
      expect((await f.admin.put("/api/admin/activity-sandbox", {})).status).toBe(400);
    });
  });
});
