/**
 * Activity runs sit beside the sidebar's pages, never inside them (state/sessions.tsx).
 *
 * Every fetch asks the server to leave an activity's generation runs out of the page and the
 * totals (`excludeActivityRuns`), so no "More" counts a run the list will not draw among the
 * conversations. The newest runs come back on their own and are held with the rows, because
 * the run folder and the run-finished notifications read them; adding or removing one never
 * moves a total.
 *
 * The store is exercised directly (node, no DOM); the API module is mocked at the seam.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "@prismshadow/penguin-server/api";

vi.mock("../src/api/endpoints", () => ({
  listSessions: vi.fn(),
  listActivityRunSessions: vi.fn(),
}));

import * as api from "../src/api/endpoints";
import { createSessionsStore } from "../src/state/sessions";

const listSessions = vi.mocked(api.listSessions);
const listActivityRunSessions = vi.mocked(api.listActivityRunSessions);

// One archived row, so the archived folder has a page to fetch.
const COUNTS = { active: 1, subagent: 0, schedule: 0, benchmark: 0, archived: 1 };

function session(sessionId: string, over: Partial<SessionInfo> = {}): SessionInfo {
  return {
    sessionId,
    projectId: "proj",
    agentId: "default_agent",
    provider: "anthropic",
    modelId: "claude-sonnet-4",
    workspace: "/w",
    approvalMode: "allow-all",
    createdAt: "2026-10-10T09:00:00.000Z",
    lastActiveAt: "2026-10-10T09:00:00.000Z",
    status: "idle",
    pendingApprovalCount: 0,
    pendingFollowUpCount: 0,
    hasTrace: true,
    archived: false,
    ...over,
  };
}

beforeEach(() => {
  listSessions.mockReset();
  listActivityRunSessions.mockReset();
});

describe("activity runs beside the pages", () => {
  async function loadedStore() {
    listSessions.mockResolvedValue({
      sessions: [session("own")],
      counts: COUNTS,
      workspaceCounts: { "/w": COUNTS },
    });
    // The newest runs come from the Project's run stream, beside the pages.
    listActivityRunSessions.mockResolvedValue({
      sessions: [session("run-1", { activityId: "act_1", status: "running" })],
      total: 1,
    });
    const store = createSessionsStore();
    store.setState({ projectId: "proj", agentIds: ["default_agent"] });
    await store.getState().reload();
    return store;
  }

  it("every fetch leaves runs out of the page and the totals", async () => {
    const store = await loadedStore();
    expect(listSessions.mock.calls[0]![2]).toMatchObject({ excludeActivityRuns: true });
    listSessions.mockClear();
    listSessions.mockResolvedValue({ sessions: [] });
    await store.getState().loadMoreFor(["default_agent"], "archived");
    expect(listSessions.mock.calls[0]![2]).toMatchObject({ excludeActivityRuns: true });
  });

  it("holds the runs served beside the page, with the totals as the server gave them", async () => {
    const store = await loadedStore();
    expect(store.getState().sessions.map((s) => s.sessionId)).toEqual(["own", "run-1"]);
    expect(store.getState().countsByAgent.get("default_agent")?.active).toBe(1);
    // The pair's cursor counts the page's rows only: the next page starts after "own".
    expect(store.getState().pageState.get("default_agent\0active\0")?.fetched).toBe(1);
  });

  it("a run added or removed later never moves a total", async () => {
    const store = await loadedStore();
    store.getState().add(session("run-2", { activityId: "act_2", workspace: "/r" }));
    expect(store.getState().countsByAgent.get("default_agent")?.active).toBe(1);
    expect(store.getState().workspaceCountsByAgent.get("default_agent")?.["/r"]).toBeUndefined();
    store.getState().remove("run-1");
    expect(store.getState().countsByAgent.get("default_agent")?.active).toBe(1);
  });
});
