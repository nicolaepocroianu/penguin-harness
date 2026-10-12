/**
 * A session's `activityId`: activity-run sessions are listed Project-wide as their activity's,
 * and kept out of an Agent's own pages on request. (The lookup itself is ActivityRuns', tested
 * in activity-run-store.test.ts.)
 */
import { describe, expect, it } from "vitest";
import type { ActivityDetail } from "../src/activities/domain.js";
import type { ActivityRunSessionsResponse, SessionsResponse } from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";

describe("session -> activity", () => {
  it("lists runs Project-wide, and keeps them out of an Agent's pages on request", async () => {
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
        await client.get(`${base}&excludeActivityRuns=1`)
      ).json()) as SessionsResponse;
      expect(own.sessions.map((s) => s.sessionId)).toEqual(["plain-chat"]);
      expect(own.counts?.active).toBe(1);
    } finally {
      await t.cleanup();
    }
  });
});
