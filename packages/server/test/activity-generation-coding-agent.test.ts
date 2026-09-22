/**
 * Agent-driven activity stages run on an external coding agent: the run is an ordinary
 * Session whose model is the coding agent — a real spawned ACP agent takes the stage's prompt
 * in the run's workspace — and is followed and collected exactly as a Penguin agent's run is.
 */
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ActivityDetail, ActivityDraft, ActivityRun } from "../src/activities/domain.js";
import type { ActivityGenerationService } from "../src/activities/generation.js";
import { findLatestTraceFile, readTrace, tracesDir } from "@prismshadow/penguin-core";
import { activitySpec } from "./activity-fixtures.js";
import { apiClient, createTestApp, loginAdmin, type TestApp } from "./helpers.js";

const STAGE_AGENT = fileURLToPath(new URL("./coding-agents-stage-agent.mjs", import.meta.url));

describe("activity stages on an external coding agent", () => {
  let t: TestApp;
  afterEach(async () => {
    await t.cleanup();
  });

  async function fixture(env: Record<string, string>) {
    t = await createTestApp();
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    expect(
      (
        await admin.post("/api/coding-agents/agents", {
          id: "stage-agent",
          command: process.execPath,
          args: [STAGE_AGENT],
          env,
        })
      ).status,
    ).toBe(201);
    const project = await admin.post("/api/projects", { projectId: "coding_stage" });
    expect(project.status, await project.clone().text()).toBe(201);
    const base = "/api/projects/coding_stage/activities";
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
    const service = t.deps.tree.api<ActivityGenerationService>(
      "ActivitiesModule",
      "ActivityGeneration",
    );
    const startSpec = async () => {
      const response = await admin.post(`${endpoint}/generate-spec`, {
        codingAgentId: "stage-agent",
        expectedRevision: draft.contentRevision,
      });
      expect(response.status, await response.clone().text()).toBe(202);
      return (await response.json()) as ActivityRun;
    };
    /** Reconcile until the run leaves `running`; the agent is a real process. */
    const settle = async (runId: string) => {
      for (let i = 0; i < 200; i++) {
        await service.reconcile();
        const { runs } = (await (await admin.get(`${endpoint}/runs`)).json()) as {
          runs: ActivityRun[];
        };
        const run = runs.find((r) => r.runId === runId)!;
        if (run.status !== "running") return run;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error("run never settled");
    };
    const traceOf = async (sessionId: string) => {
      const located = await findLatestTraceFile(
        tracesDir(t.root, "coding_stage", "default_agent"),
        sessionId,
      );
      if (located === null) throw new Error("no Trace yet");
      return (await readTrace(located.path)).map(
        (m) => m.payload as { type?: string } & Record<string, unknown>,
      );
    };
    return { admin, endpoint, startSpec, settle, traceOf };
  }

  it("generates a specification and applies it to the draft", async () => {
    const { admin, endpoint, startSpec, settle, traceOf } = await fixture({
      FAKE_STAGE_SPEC: JSON.stringify(activitySpec),
    });
    const run = await startSpec();
    // Filed under the Project's default Agent, like any Session started without one named.
    expect(run).toMatchObject({
      status: "running",
      codingAgentId: "stage-agent",
      agentId: "default_agent",
    });
    expect(run.sessionId).toMatch(/^session-/);
    const settled = await settle(run.runId);
    expect(settled.status, settled.error ?? "").toBe("succeeded");
    const detail = (await (await admin.get(endpoint)).json()) as ActivityDetail;
    expect(detail.draft.spec).toMatchObject({ title: activitySpec.title });
    // The run is an ordinary Session: listed, and its Trace is the audit trail.
    const payloads = await traceOf(run.sessionId!);
    expect(payloads[0]).toMatchObject({ provider: "coding-agent", model_id: "stage-agent" });
    expect(payloads.at(-1)).toMatchObject({ type: "request_end", status: "completed" });
  });

  it("fails the run with the agent's own reason when it stops short", async () => {
    const { startSpec, settle } = await fixture({ FAKE_STAGE_STOP: "refusal" });
    const settled = await settle((await startSpec()).runId);
    expect(settled).toMatchObject({
      status: "failed",
      error: "The coding agent refused the task.",
    });
  });

  it("cancels the agent's turn when the run is cancelled", async () => {
    const { admin, endpoint, startSpec, traceOf } = await fixture({ FAKE_STAGE_WAIT: "cancel" });
    const run = await startSpec();
    const cancelled = await admin.post(`${endpoint}/runs/${run.runId}/cancel`, {});
    expect(cancelled.status).toBe(200);
    expect(((await cancelled.json()) as ActivityRun).status).toBe("cancelled");
    // The Session was stopped, which cancelled the agent's turn rather than leaving it running.
    for (let i = 0; i < 400; i++) {
      const payloads = await traceOf(run.sessionId!).catch(() => []);
      if (payloads.some((p) => p.type === "abort")) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("the run's Session was never stopped");
  });

  it("requires a Penguin agent or a coding agent to run a stage", async () => {
    const { admin, endpoint } = await fixture({});
    const response = await admin.post(`${endpoint}/generate-spec`, { expectedRevision: "x" });
    expect(response.status).toBe(400);
  });
});
