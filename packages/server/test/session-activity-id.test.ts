/**
 * A session's `activityId`: SessionsRepo maps activity-run sessions to the activity whose run
 * they are, project-wide (activityIdsOfProject, the session list's one-query path) and per
 * session (activityIdOfSession). Only rows the record names as their session count, and a
 * session belonging to another project's activity run never appears in this project's map.
 */
import { describe, expect, it } from "vitest";
import type { ActivityDetail } from "../src/activities/domain.js";
import type { ActivityRunSessionsResponse, SessionsResponse } from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";

describe("session -> activity", () => {
  it("maps a project's activity-run sessions to their activity, and nothing else", async () => {
    const t = await createTestApp();
    try {
      const owner = await provisionUser(t.app, "activity_session_owner");
      const client = apiClient(t.app, owner.cookie);
      const p1 = "activity_session_owner-p1";
      const p2 = "activity_session_owner-p2";

      expect((await client.post("/api/projects", { projectId: p1 })).status).toBe(201);
      expect((await client.post("/api/projects", { projectId: p2 })).status).toBe(201);

      // A product code belongs to one project, so each project gets its own.
      const createActivity = async (projectId: string, refNum: number): Promise<ActivityDetail> => {
        const response = await client.post(`/api/projects/${projectId}/activities`, {
          productCode: projectId === p1 ? "words" : "letters",
          refNum,
          title: `words ${refNum}`,
        });
        expect(response.status, await response.clone().text()).toBe(201);
        return (await response.json()) as ActivityDetail;
      };

      const act1 = await createActivity(p1, 1);
      const act9 = await createActivity(p2, 9);

      const insert = t.deps.db.prepare(
        "INSERT INTO activity_runs (run_id, project_id, activity_id, status, created_at, kind, record_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      insert.run(
        "run_1",
        p1,
        act1.id,
        "succeeded",
        "2026-09-28",
        "spec",
        JSON.stringify({ sessionId: "s1" }),
      );
      insert.run(
        "run_2",
        p1,
        act1.id,
        "succeeded",
        "2026-09-28",
        "audio",
        JSON.stringify({ sessionId: null }),
      );
      insert.run(
        "run_3",
        p2,
        act9.id,
        "succeeded",
        "2026-09-28",
        "spec",
        JSON.stringify({ sessionId: "s9" }),
      );

      const repo = t.deps.sessionsRepo;
      expect([...repo.activityIdsOfProject(p1)]).toEqual([["s1", act1.id]]);
      expect(repo.activityIdOfSession("s1")).toBe(act1.id);
      expect(repo.activityIdOfSession("s-unknown")).toBeUndefined();
      // A session belonging to another project's activity run never appears in this project's map.
      expect(repo.activityIdsOfProject(p1).has("s9")).toBe(false);
    } finally {
      await t.cleanup();
    }
  });

  it("lists runs Project-wide, keeps them out of an Agent's pages on request, and follows a self-healed id", async () => {
    const t = await createTestApp();
    try {
      const owner = await provisionUser(t.app, "activity_stream_owner");
      const client = apiClient(t.app, owner.cookie);
      const projectId = "activity_stream_owner-p1";
      expect((await client.post("/api/projects", { projectId })).status).toBe(201);
      const created = await client.post(`/api/projects/${projectId}/activities`, {
        productCode: "words",
        refNum: 3,
        title: "words 3",
      });
      expect(created.status, await created.clone().text()).toBe(201);
      const activity = (await created.json()) as ActivityDetail;

      const session = (sessionId: string, createdAt: string, archivedAt?: string) => {
        t.deps.sessionsRepo.insert({
          sessionId,
          projectId,
          agentId: "default_agent",
          provider: "anthropic",
          modelId: "claude-sonnet-4-6",
          workspace: "/w",
          approvalMode: "allow-all",
          title: null,
          client: "web",
          lastActiveAt: createdAt,
          createdAt,
        });
        if (archivedAt) t.deps.sessionsRepo.setArchived(sessionId, archivedAt);
      };
      const insertRun = t.deps.db.prepare(
        "INSERT INTO activity_runs (run_id, project_id, activity_id, status, created_at, kind, record_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      // Twelve runs (more than one sidebar page), one archived, plus an ordinary conversation.
      for (let i = 1; i <= 12; i++) {
        const sid = `run-session-${String(i).padStart(2, "0")}`;
        session(
          sid,
          `2026-10-01T00:00:${String(i).padStart(2, "0")}.000Z`,
          i === 1 ? "2026-10-02T00:00:00.000Z" : undefined,
        );
        insertRun.run(
          `run_${i}`,
          projectId,
          activity.id,
          "succeeded",
          "2026-10-01",
          "spec",
          JSON.stringify({ sessionId: sid }),
        );
      }
      session("plain-chat", "2026-10-01T00:01:00.000Z");

      const stream = (await (
        await client.get(`/api/projects/${projectId}/activity-sessions?limit=5&offset=0`)
      ).json()) as ActivityRunSessionsResponse;
      expect(stream.total).toBe(11);
      expect(stream.sessions.map((s) => s.sessionId)).toEqual([
        "run-session-12",
        "run-session-11",
        "run-session-10",
        "run-session-09",
        "run-session-08",
      ]);
      expect(stream.sessions.every((s) => s.activityId === activity.id)).toBe(true);

      const base = `/api/projects/${projectId}/agents/default_agent/sessions?limit=50&offset=0&category=active&counts=1`;
      const withRuns = (await (await client.get(base)).json()) as SessionsResponse;
      expect(withRuns.counts?.active).toBe(12);
      const own = (await (
        await client.get(`${base}&excludeActivity=1`)
      ).json()) as SessionsResponse;
      expect(own.sessions.map((s) => s.sessionId)).toEqual(["plain-chat"]);
      expect(own.counts?.active).toBe(1);

      // A stage sequence that recorded the Session, as the Stages panel's history reads it.
      t.deps.db
        .prepare(
          "INSERT INTO activity_pipelines (pipeline_id, project_id, activity_id, status, record_json, started_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          "pipe-1",
          projectId,
          activity.id,
          "stopped",
          JSON.stringify({
            pipelineId: "pipe-1",
            currentSessionId: "run-session-12",
            steps: [
              { step: "spec", sessionId: "run-session-11" },
              { step: "build", sessionId: "run-session-12" },
            ],
          }),
          "2026-10-10T10:00:00.000Z",
        );

      // A Trace-less Session rebuilt under a new id stays its run's.
      t.deps.sessionsRepo.replaceId("run-session-12", "run-session-12-healed");
      expect(t.deps.sessionsRepo.activityIdOfSession("run-session-12-healed")).toBe(activity.id);
      expect(t.deps.sessionsRepo.activityIdOfSession("run-session-12")).toBeUndefined();
      // ...and the sequence that recorded it opens the rebuilt one.
      const pipeline = t.deps.db
        .prepare("SELECT record_json FROM activity_pipelines WHERE pipeline_id = ?")
        .get("pipe-1") as { record_json: string };
      expect(JSON.parse(pipeline.record_json)).toMatchObject({
        currentSessionId: "run-session-12-healed",
        steps: [
          { step: "spec", sessionId: "run-session-11" },
          { step: "build", sessionId: "run-session-12-healed" },
        ],
      });
    } finally {
      await t.cleanup();
    }
  });
});
