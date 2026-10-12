/**
 * A Session created but never run has no Trace; once its runtime is gone (a restart, an idle
 * sweep) the next access rebuilds it. It is rebuilt under its own id, so everything that
 * names the Session — a bot binding, a company desk, an activity run, the Session's own routes — still finds
 * it afterwards.
 */
import { findLatestTraceFile, tracesDir, userText } from "@prismshadow/penguin-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityDetail } from "../src/activities/domain.js";
import type { ActivityRuns } from "../src/activities/run-store.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("a Session rebuilt without a Trace", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  const projectId = "rebuild_owner-p1";

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "rebuild_owner");
    api = apiClient(t.app, cookie);
    expect((await api.post("/api/projects", { projectId })).status).toBe(201);
    const models = await api.put(`/api/projects/${projectId}/models`, {
      defaultModel: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      models: [{ provider: "anthropic", modelId: "claude-sonnet-4-6", contextWindow: 128000 }],
    });
    expect(models.status).toBe(200);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it(
    "keeps its id, and whatever names the Session still resolves it",
    { timeout: 120_000 },
    async () => {
      const created = await api.post(
        `/api/projects/${projectId}/agents/default_agent/sessions`,
        {},
      );
      expect(created.status, await created.clone().text()).toBe(201);
      const sessionId = ((await created.json()) as { session: { sessionId: string } }).session
        .sessionId;
      const traces = tracesDir(t.root, projectId, "default_agent");
      expect(await findLatestTraceFile(traces, sessionId)).toBeNull();

      // Things that name the Session: a bot binding, a company desk and an activity run.
      t.deps.messagingRepo.upsert({
        sessionId,
        channel: "telegram",
        accountId: "4242",
        config: { botToken: "4242:test" },
      });
      t.deps.orgCacheRepo.syncDeskSessions(projectId, "org_1", [
        { sessionId, agentId: "default_agent", current: true },
      ]);
      const activity = (await (
        await api.post(`/api/projects/${projectId}/activities`, {
          productCode: "words",
          refNum: 1,
          title: "words 1",
        })
      ).json()) as ActivityDetail;
      t.deps.db
        .prepare(
          "INSERT INTO activity_runs (run_id, project_id, activity_id, status, created_at, kind, record_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          "run_1",
          projectId,
          activity.id,
          "succeeded",
          "2026-10-13",
          "spec",
          JSON.stringify({ sessionId }),
        );

      // The runtime goes, as at a restart; the next access rebuilds the Session.
      t.deps.manager.sweepIdle(Date.now() + 60_000, 0);
      const started = await t.deps.manager.startTask(sessionId, [userText("hello")]);
      expect(started.sessionId).toBe(sessionId);
      // No model answers in a test: the Task is stopped once it has begun.
      t.deps.manager.abortTask(sessionId);
      await vi.waitFor(() => expect(t.deps.manager.statusOf(sessionId)).toBe("idle"), {
        timeout: 30_000,
      });

      // The rebuilt Session's Trace is written under the same id: its next resume finds it.
      expect(await findLatestTraceFile(traces, sessionId)).not.toBeNull();

      expect(t.deps.sessionsRepo.findById(sessionId)).not.toBeNull();
      expect(t.deps.sessionsRepo.listByProject(projectId).map((row) => row.sessionId)).toEqual([
        sessionId,
      ]);
      expect(t.deps.messagingRepo.find(sessionId, "telegram")).not.toBeNull();
      expect(t.deps.orgCacheRepo.ownerOfSession(sessionId)).toMatchObject({
        orgId: "org_1",
        kind: "desk",
      });
      const runs = t.deps.tree.api<ActivityRuns>("ActivitiesModule", "ActivityRuns");
      expect(runs.activityOfSession(sessionId)).toBe(activity.id);
      expect((await api.get(`/api/sessions/${sessionId}`)).status).toBe(200);
    },
  );
});
