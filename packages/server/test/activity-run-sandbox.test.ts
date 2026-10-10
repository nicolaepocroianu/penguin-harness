/**
 * An activity run's own agent works confined to the run's workspace: the WAF checkout is
 * read-only to its commands by enforcement, not by the prompt's word. Where nothing can
 * confine them the run is refused before it starts. A coding agent runs its commands
 * itself, outside Penguin's sandbox, so it is neither confined nor refused.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityDetail, ActivityDraft } from "../src/activities/domain.js";
import type { SessionEnv } from "../src/runtime/session-manager.js";
import { SandboxService } from "../src/sandbox/service.js";
import { apiClient, createTestApp, loginAdmin, type TestApp } from "./helpers.js";

const STAGE_AGENT = fileURLToPath(new URL("./coding-agents-stage-agent.mjs", import.meta.url));

describe("activity runs and the sandbox", () => {
  let t: TestApp;
  afterEach(async () => {
    vi.restoreAllMocks();
    await t.cleanup();
  });

  async function fixture(sandbox?: SandboxService) {
    t = await createTestApp(sandbox ? { sandbox } : {});
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
    return { admin, endpoint, revision: draft.contentRevision, createSession, runs };
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

  it("gives a confined Session's commands an npm cache inside its workspace", async () => {
    t = await createTestApp();
    const env = t.deps.tree.api<SessionEnv>("SessionRuntimeModule", "SessionEnv");
    const session = { projectId: "p", agentId: "a", sessionId: "s", workspaceDir: "/runs/r1" };
    expect(env.controlEnv({ ...session, sandboxMode: "workspace-write" })).toMatchObject({
      npm_config_cache: path.join("/runs/r1", ".npm-cache"),
    });
    expect(env.controlEnv(session)).not.toHaveProperty("npm_config_cache");
  });

  it("starts a coding agent's run without a sandbox, and does not hand it a floor", async () => {
    const f = await fixture(new SandboxService([]));
    expect(
      (
        await f.admin.post("/api/coding-agents/agents", {
          id: "stage-agent",
          command: process.execPath,
          args: [STAGE_AGENT],
          env: {},
        })
      ).status,
    ).toBe(201);
    const response = await f.admin.post(`${f.endpoint}/generate-spec`, {
      codingAgentId: "stage-agent",
      expectedRevision: f.revision,
    });
    expect(response.status, await response.clone().text()).toBe(202);
    await vi.waitFor(() => expect(f.createSession).toHaveBeenCalled());
    expect(f.createSession.mock.calls[0]![0]).not.toHaveProperty("sandboxMode");
  });
});
