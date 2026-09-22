/**
 * Coding agents as ordinary Penguin Sessions, end to end over HTTP against a real spawned ACP
 * agent: created by picking a `coding-agent` model, listed with every other Session, turns
 * streamed and written to the Session's Trace, the agent's permission asks answered through
 * Penguin's own approvals, and the Session reopened by its runtime once its entry is gone.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findLatestTraceFile, readTrace, tracesDir } from "@prismshadow/penguin-core";
import type { SessionInfo } from "../src/api/types.js";
import type { CodingAgents } from "../src/mechanisms/coding-agents.js";
import { apiClient, createTestApp, loginAdmin, waitFor, type TestApp } from "./helpers.js";

const AGENT_MAIN = fileURLToPath(new URL("./coding-agents-agent.mjs", import.meta.url));

type Payload = { type?: string; text?: string; role?: string; decision?: string };

describe("coding-agent Sessions", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;
  let projectId: string;

  beforeEach(async () => {
    t = await createTestApp();
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const saved = await admin.post("/api/coding-agents/agents", {
      id: "fake",
      title: "Fake Agent",
      command: process.execPath,
      args: [AGENT_MAIN],
    });
    expect(saved.status).toBe(201);
    const { projects } = (await (await admin.get("/api/projects")).json()) as {
      projects: { projectId: string }[];
    };
    projectId = projects[0]!.projectId;
  });

  afterEach(async () => {
    await t.cleanup();
  });

  async function createSession(body: Record<string, unknown> = {}): Promise<SessionInfo> {
    const res = await admin.post(`/api/projects/${projectId}/agents/default_agent/sessions`, {
      provider: "coding-agent",
      modelId: "fake",
      ...body,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return ((await res.json()) as { session: SessionInfo }).session;
  }

  async function send(sessionId: string, text: string): Promise<void> {
    const res = await admin.post(`/api/sessions/${sessionId}/tasks`, {
      input: [{ type: "text", text }],
    });
    expect(res.status, await res.clone().text()).toBeLessThan(300);
  }

  const idle = (sessionId: string) => t.deps.manager.statusOf(sessionId) === "idle";

  async function trace(sessionId: string): Promise<Payload[]> {
    const located = await findLatestTraceFile(
      tracesDir(t.root, projectId, "default_agent"),
      sessionId,
    );
    expect(located, "the Session has a Trace").not.toBeNull();
    return (await readTrace(located!.path)).map((m) => m.payload as Payload);
  }

  it("runs a turn and records it in the Session's Trace like any other Session", async () => {
    const session = await createSession();
    expect(session).toMatchObject({ provider: "coding-agent", modelId: "fake" });
    expect(session.sessionId).toMatch(/^session-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-[0-9a-f]{8}$/);

    await send(session.sessionId, "hi");
    await waitFor(() => idle(session.sessionId), 10_000);

    const recorded = await trace(session.sessionId);
    expect(recorded[0]).toMatchObject({ provider: "coding-agent", model_id: "fake" });
    expect(recorded.slice(1).map((p) => p.type)).toEqual([
      "text",
      "request_begin",
      "text",
      "request_end",
    ]);
    expect(recorded[1]).toMatchObject({ role: "user", text: "hi" });
    expect(recorded[3]).toMatchObject({ role: "assistant", text: "hello from subprocess" });

    // Listed with every other Session of the Agent.
    const list = (await (
      await admin.get(`/api/projects/${projectId}/agents/default_agent/sessions`)
    ).json()) as { sessions: SessionInfo[] };
    expect(list.sessions.map((s) => s.sessionId)).toContain(session.sessionId);
  });

  it("puts the agent's permission asks through the Session's approvals", async () => {
    const session = await createSession({ approvalMode: "always-ask" });
    await send(session.sessionId, "ask permission");
    // The ask waits for a person, exactly as a core Session's tool call would.
    let decided = 404;
    for (let i = 0; i < 200 && decided !== 204; i++) {
      decided = (
        await admin.post(`/api/sessions/${session.sessionId}/approvals/perm-tool`, {
          decision: "deny",
        })
      ).status;
      if (decided !== 204) await new Promise((r) => setTimeout(r, 25));
    }
    expect(decided).toBe(204);
    await waitFor(() => idle(session.sessionId), 10_000);

    const recorded = await trace(session.sessionId);
    expect(recorded).toContainEqual(
      expect.objectContaining({ type: "tool_call", name: "Write notes.txt" }),
    );
    expect(recorded).toContainEqual(
      expect.objectContaining({ type: "approval_decision", decision: "deny" }),
    );
    expect(recorded).toContainEqual(
      expect.objectContaining({ role: "assistant", text: "did not write it" }),
    );
  });

  it("lets an allow-all Session's agent act without asking", async () => {
    const session = await createSession({ approvalMode: "allow-all" });
    await send(session.sessionId, "ask permission");
    await waitFor(() => idle(session.sessionId), 10_000);
    expect(await trace(session.sessionId)).toContainEqual(
      expect.objectContaining({ role: "assistant", text: "wrote it" }),
    );
  });

  it("reopens the Session through its agent and keeps writing the same Trace", async () => {
    const session = await createSession();
    await send(session.sessionId, "hi");
    await waitFor(() => idle(session.sessionId), 10_000);

    // Drop the live entry, as idle eviction or a restart does: the next turn goes through
    // the loader, which must reopen the agent's session rather than ask core.
    t.deps.manager.sweepIdle(Date.now() + 60_000, 0);
    // A restart loses the agent process too: the reopen has to go back to the agent.
    const codingAgents = t.deps.tree.api<CodingAgents>("CodingAgentsModule", "CodingAgents");
    const link = path.join(
      t.root,
      "coding-agents",
      "fake",
      "sessions",
      `${session.sessionId}.json`,
    );
    const { acpSessionId } = JSON.parse(await fs.readFile(link, "utf8")) as {
      acpSessionId: string;
    };
    await codingAgents.disposeSession(acpSessionId);
    expect(codingAgents.listSessions()).toEqual([]);
    await send(session.sessionId, "again");
    await waitFor(() => idle(session.sessionId), 10_000);

    const recorded = await trace(session.sessionId);
    expect(recorded.filter((p) => p.type === "session_meta" || "session_id" in p)).toHaveLength(1);
    expect(recorded.filter((p) => p.role === "user").map((p) => p.text)).toEqual(["hi", "again"]);
    expect(recorded.filter((p) => p.type === "request_end")).toHaveLength(2);
    // The fixture advertises session/resume, so the Session went on in the same agent
    // session, with no "continues in a fresh session" note.
    expect(recorded.some((p) => p.text?.includes("fresh agent session"))).toBe(false);
    expect(codingAgents.listSessions().map((s) => s.sessionId)).toEqual([acpSessionId]);
  });

  it("goes on in a fresh agent session, and says so, when the agent cannot reopen one", async () => {
    expect(
      (
        await admin.post("/api/coding-agents/agents", {
          id: "plain",
          command: process.execPath,
          args: [AGENT_MAIN],
          env: { FAKE_NO_RESUME: "1" },
        })
      ).status,
    ).toBe(201);
    const session = await createSession({ modelId: "plain" });
    await send(session.sessionId, "hi");
    await waitFor(() => idle(session.sessionId), 10_000);
    t.deps.manager.sweepIdle(Date.now() + 60_000, 0);
    const codingAgents = t.deps.tree.api<CodingAgents>("CodingAgentsModule", "CodingAgents");
    for (const open of codingAgents.listSessions())
      await codingAgents.disposeSession(open.sessionId);

    await send(session.sessionId, "again");
    await waitFor(() => idle(session.sessionId), 10_000);
    const recorded = await trace(session.sessionId);
    expect(recorded.filter((p) => p.role === "user").map((p) => p.text)).toEqual(["hi", "again"]);
    expect(recorded.some((p) => p.text?.includes("fresh agent session"))).toBe(true);
  });

  it("offers coding agents with the Project's models, never among them", async () => {
    const models = (await (await admin.get(`/api/projects/${projectId}/models`)).json()) as {
      models: { provider: string }[];
      codingAgentModels: { provider: string; modelId: string; displayName?: string }[];
    };
    expect(models.codingAgentModels).toContainEqual(
      expect.objectContaining({
        provider: "coding-agent",
        modelId: "fake",
        displayName: "Fake Agent",
      }),
    );
    expect(models.models.some((m) => m.provider === "coding-agent")).toBe(false);
  });

  it("records what the agent said each turn used and cost, and counts it in the Project's usage", async () => {
    expect(
      (
        await admin.post("/api/coding-agents/agents", {
          id: "priced",
          command: process.execPath,
          args: [AGENT_MAIN],
          env: { FAKE_USAGE: "1" },
        })
      ).status,
    ).toBe(201);
    const session = await createSession({ modelId: "priced" });
    for (const text of ["one", "two"]) {
      await send(session.sessionId, text);
      await waitFor(() => idle(session.sessionId), 10_000);
    }
    const usages = (await trace(session.sessionId)).filter((p) => p.type === "token_usage") as {
      request: { total: number; output: number };
      reported_cost?: { amount: number; currency: string };
    }[];
    expect(usages.map((u) => u.request)).toEqual([
      { cache_read: 10, cache_write: 0, output: 20, total: 130 },
      { cache_read: 10, cache_write: 0, output: 20, total: 130 },
    ]);
    // The agent's running total was 0.25 then 0.50: each turn is charged what it added.
    expect(usages.map((u) => u.reported_cost)).toEqual([
      { amount: 0.25, currency: "USD" },
      { amount: 0.25, currency: "USD" },
    ]);

    const usage = (await (
      await admin.get(`/api/projects/${projectId}/usage?groupBy=model`)
    ).json()) as {
      summary: { total: { cost: number | null; hasUncosted: boolean; total: number } };
      groups: { key: string; provider?: string; cost: number | null; hasUncosted: boolean }[];
    };
    const row = usage.groups.find((g) => g.provider === "coding-agent" && g.key === "priced");
    expect(row).toMatchObject({ cost: 0.5, hasUncosted: false });
    expect(usage.summary.total.cost).toBeCloseTo(0.5);
    expect(usage.summary.total.total).toBe(260);
  });

  it("keeps a protected folder out of the agent's reach even when the Session allows everything", async () => {
    const guarded = await fs.mkdtemp(path.join(os.tmpdir(), "guarded-checkout-"));
    try {
      expect(
        (
          await admin.post("/api/coding-agents/agents", {
            id: "writer",
            command: process.execPath,
            args: [AGENT_MAIN],
            env: { FAKE_ASK_PATH: path.join(guarded, "framework", "index.ts") },
          })
        ).status,
      ).toBe(201);
      // The activity stages' own path: a Session created in-process with protected roots.
      const session = await t.deps.sessionService.createSession({
        projectId,
        agentId: "default_agent",
        provider: "coding-agent",
        modelId: "writer",
        approvalMode: "allow-all",
        protectedRoots: [{ root: guarded, label: "the shared WAF checkout" }],
      });
      await send(session.sessionId, "ask permission");
      await waitFor(() => idle(session.sessionId), 10_000);
      const recorded = await trace(session.sessionId);
      expect(recorded).toContainEqual(expect.objectContaining({ text: "did not write it" }));
      expect(recorded.some((p) => p.text?.includes("the shared WAF checkout"))).toBe(true);
    } finally {
      await fs.rm(guarded, { recursive: true, force: true });
    }
  });

  it("refuses a coding agent that does not exist, as it would an unknown model", async () => {
    const res = await admin.post(`/api/projects/${projectId}/agents/default_agent/sessions`, {
      provider: "coding-agent",
      modelId: "no-such-agent",
    });
    expect(res.status).toBe(400);
  });

  it("remembers which agent session a Session is, so a restart can reopen it", async () => {
    const session = await createSession();
    await send(session.sessionId, "hi");
    await waitFor(() => idle(session.sessionId), 10_000);
    const link = path.join(
      t.root,
      "coding-agents",
      "fake",
      "sessions",
      `${session.sessionId}.json`,
    );
    expect(JSON.parse(await fs.readFile(link, "utf8"))).toHaveProperty("acpSessionId");
  });
});
