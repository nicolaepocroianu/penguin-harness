/**
 * The sidebar's Activity runs folder in the sessions store (state/sessions.tsx): the Project's
 * activity runs are one stream of their own (listActivityRunSessions), held beside the Agents'
 * pages, which leave runs out (`excludeActivityRuns`) except the ones still in flight.
 *
 * - A reload reads the run stream as far as it was read, at least its first page, in pages the
 *   server accepts; More reads on from the rows already read.
 * - Only the stream's rows and the runs in flight an Agent's page serves are held.
 * - Archiving, restoring or deleting a run moves the folder's total, and its cursor when the run
 *   is one the stream served; a run never moves an Agent's totals.
 * - A failed run fetch keeps the loaded runs and their paging.
 *
 * The store is exercised directly (node, no DOM); the API module is mocked at the seam.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SessionBatchPageRequest,
  SessionInfo,
  SessionsResponse,
} from "@prismshadow/penguin-server/api";

vi.mock("../src/api/endpoints", () => ({
  batchSessions: vi.fn(),
  listActivityRunSessions: vi.fn(),
  getSession: vi.fn(),
}));

import * as api from "../src/api/endpoints";
import { createSessionsStore } from "../src/state/sessions";

const batchSessions = vi.mocked(api.batchSessions);
const listActivityRunSessions = vi.mocked(api.listActivityRunSessions);

const NO_ROWS: SessionsResponse = { sessions: [] };
const COUNTS = { active: 1, subagent: 1, schedule: 0, benchmark: 0, archived: 0 };

/** Every page this server is asked for in a reload answers `res`. */
function answerPages(res: SessionsResponse): void {
  batchSessions.mockImplementation(async (_projectId, requests: SessionBatchPageRequest[]) => ({
    results: requests.map((r) => ({ agentId: r.agentId, ok: true as const, ...res })),
  }));
}

function session(sessionId: string, over: Partial<SessionInfo> = {}): SessionInfo {
  return {
    sessionId,
    projectId: "proj",
    agentId: "default_agent",
    provider: "anthropic",
    modelId: "claude-sonnet-4",
    workspace: "/w",
    approvalMode: "allow-all",
    sandbox: { mode: "danger-full-access", network: "open" },
    createdAt: "2026-09-16T09:00:00.000Z",
    lastActiveAt: "2026-09-16T09:00:00.000Z",
    status: "idle",
    pendingApprovalCount: 0,
    pendingFollowUpCount: 0,
    hasTrace: true,
    archived: false,
    ...over,
  };
}

beforeEach(() => {
  batchSessions.mockReset();
  answerPages(NO_ROWS);
  listActivityRunSessions.mockReset();
  listActivityRunSessions.mockResolvedValue({ sessions: [], total: 0 });
});

describe("activity runs page as one Project-wide stream", () => {
  const run = (n: number) =>
    session(`run-${n}`, {
      activityId: "act-1",
      agentId: n % 2 ? "activity_agent" : "default_agent",
    });

  it("reload() loads the newest runs with their total, and loadMoreActivityRuns() reads on", async () => {
    answerPages({ ...NO_ROWS, counts: COUNTS });
    listActivityRunSessions.mockResolvedValueOnce({
      sessions: Array.from({ length: 10 }, (_, i) => run(25 - i)),
      total: 25,
    });
    const store = createSessionsStore();
    store.setState({ projectId: "proj", agentIds: ["default_agent"] });
    await store.getState().reload();
    // The first page holds every run in flight; later pages are the sidebar's size.
    expect(listActivityRunSessions).toHaveBeenCalledWith("proj", { offset: 0, limit: 50 });
    expect(store.getState().activityRuns).toEqual({ total: 25, fetched: 10, hasMore: true });

    listActivityRunSessions.mockResolvedValueOnce({
      sessions: Array.from({ length: 10 }, (_, i) => run(15 - i)),
      total: 25,
    });
    await store.getState().loadMoreActivityRuns();
    expect(listActivityRunSessions).toHaveBeenLastCalledWith("proj", { offset: 10, limit: 10 });
    expect(store.getState().sessions.filter((s) => s.activityId)).toHaveLength(20);
    expect(store.getState().activityRuns).toEqual({ total: 25, fetched: 20, hasMore: true });
  });

  it("a reload keeps as many runs as were already read, so an open folder does not shrink", async () => {
    answerPages({ ...NO_ROWS, counts: COUNTS });
    const store = createSessionsStore();
    store.setState({
      projectId: "proj",
      agentIds: ["default_agent"],
      activityRuns: { total: 90, fetched: 70, hasMore: true },
    });
    await store.getState().reload();
    expect(listActivityRunSessions).toHaveBeenCalledWith("proj", { offset: 0, limit: 70 });
  });

  it("a run row never moves an Agent's totals", async () => {
    answerPages({ sessions: [session("own")], counts: COUNTS });
    const store = createSessionsStore();
    store.setState({ projectId: "proj", agentIds: ["default_agent"] });
    await store.getState().reload();
    store.getState().add(run(2));
    expect(store.getState().countsByAgent.get("default_agent")?.active).toBe(1);
  });
});

describe("the Activity runs folder keeps its place", () => {
  const run = (id: string, over: Partial<SessionInfo> = {}) =>
    session(id, { activityId: "act", ...over });

  it("archiving a loaded run moves the cursor back, so More still reaches the last run", async () => {
    answerPages({ ...NO_ROWS, counts: COUNTS });
    const rows = Array.from({ length: 10 }, (_, i) => run(`run_${i}`));
    listActivityRunSessions.mockResolvedValue({ sessions: rows, total: 11 });
    const store = createSessionsStore();
    store.setState({ projectId: "proj", agentIds: ["default_agent"] });
    await store.getState().reload();
    store.getState().replace(run("run_3", { archived: true }));
    expect(store.getState().activityRuns).toEqual({ total: 10, fetched: 9, hasMore: true });
    store.getState().replace(run("run_3"));
    expect(store.getState().activityRuns).toEqual({ total: 11, fetched: 10, hasMore: true });
  });

  it("a reload already under way when a run is archived does not undo the move", async () => {
    answerPages({ ...NO_ROWS, counts: COUNTS });
    const rows = Array.from({ length: 10 }, (_, i) => run(`run_${i}`));
    listActivityRunSessions.mockResolvedValue({ sessions: rows, total: 11 });
    const store = createSessionsStore();
    store.setState({ projectId: "proj", agentIds: ["default_agent"] });
    await store.getState().reload();
    let answer!: (value: { sessions: SessionInfo[]; total: number }) => void;
    listActivityRunSessions.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const stale = store.getState().reload();
    store.getState().replace(run("run_3", { archived: true }));
    answer({ sessions: rows, total: 11 });
    await stale;
    expect(store.getState().activityRuns).toEqual({ total: 10, fetched: 9, hasMore: true });
    expect(store.getState().sessions.find((s) => s.sessionId === "run_3")?.archived).toBe(true);
    // The dropped reload still ends its loading cycle.
    expect(store.getState().loading).toBe(false);
  });

  it("a reload a new Session cut short still ends its loading cycle", async () => {
    answerPages({ ...NO_ROWS, counts: COUNTS });
    let answer!: (value: { sessions: SessionInfo[]; total: number }) => void;
    listActivityRunSessions.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const store = createSessionsStore();
    store.setState({ projectId: "proj", agentIds: ["default_agent"] });
    const pending = store.getState().reload();
    expect(store.getState().loading).toBe(true);
    store.getState().add(session("fresh"));
    answer({ sessions: [], total: 0 });
    await pending;
    expect(store.getState().loading).toBe(false);
    expect(store.getState().sessions.map((s) => s.sessionId)).toEqual(["fresh"]);
  });

  it("a Project switch while a cancelled reload is in flight leaves the new Project loading", async () => {
    answerPages({ ...NO_ROWS, counts: COUNTS });
    let answer!: (value: { sessions: SessionInfo[]; total: number }) => void;
    listActivityRunSessions.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const store = createSessionsStore();
    store.setState({ projectId: "proj", agentIds: ["default_agent"] });
    const old = store.getState().reload();
    store.getState().add(session("fresh"));
    // The Provider's reset for the next Project: rows cleared, loading raised, no Agents yet.
    store.setState({ projectId: "other", agentIds: [], sessions: [], loading: true });
    await store.getState().reload();
    answer({ sessions: [run("run_old")], total: 1 });
    await old;
    expect(store.getState().loading).toBe(true);
    expect(store.getState().sessions).toEqual([]);
  });

  it("holds the run stream's rows, plus only the runs in flight an Agent's page serves", async () => {
    answerPages({
      ...NO_ROWS,
      counts: COUNTS,
      // An Agent's page also serves its newest runs: a finished one is left to the stream's
      // paging, a running one is kept so its completion is still noticed.
      activityRuns: [run("agent_done"), run("agent_running", { status: "running" })],
    });
    listActivityRunSessions.mockResolvedValue({ sessions: [run("run_a")], total: 30 });
    const store = createSessionsStore();
    store.setState({ projectId: "proj", agentIds: ["default_agent"] });
    await store.getState().reload();
    expect(store.getState().sessions.map((s) => s.sessionId)).toEqual(["run_a", "agent_running"]);
    expect(store.getState().activityRuns).toEqual({ total: 30, fetched: 1, hasMore: true });
  });

  it("archiving or deleting a run the stream's pages never served moves only the total", async () => {
    answerPages({
      ...NO_ROWS,
      counts: COUNTS,
      activityRuns: [run("agent_running", { status: "running" })],
    });
    listActivityRunSessions.mockResolvedValue({
      sessions: [run("run_a"), run("run_b")],
      total: 30,
    });
    const store = createSessionsStore();
    store.setState({ projectId: "proj", agentIds: ["default_agent"] });
    await store.getState().reload();
    store.getState().replace(run("agent_running", { status: "running", archived: true }));
    expect(store.getState().activityRuns).toEqual({ total: 29, fetched: 2, hasMore: true });
    store.getState().remove("agent_running");
    expect(store.getState().activityRuns).toEqual({ total: 28, fetched: 2, hasMore: true });
    // A run the stream served still moves the cursor.
    store.getState().remove("run_a");
    expect(store.getState().activityRuns).toEqual({ total: 27, fetched: 1, hasMore: true });
  });

  it("refetches more than the server's largest page in pages it accepts", async () => {
    answerPages({ ...NO_ROWS, counts: COUNTS });
    listActivityRunSessions.mockImplementation(async (_projectId, paging) => ({
      sessions: Array.from({ length: paging!.limit }, (_, i) => run(`run_${paging!.offset + i}`)),
      total: 1500,
    }));
    const store = createSessionsStore();
    store.setState({
      projectId: "proj",
      agentIds: ["default_agent"],
      activityRuns: { total: 1500, fetched: 1200, hasMore: true },
    });
    await store.getState().reload();
    expect(listActivityRunSessions.mock.calls.map((call) => call[1])).toEqual([
      { offset: 0, limit: 1000 },
      { offset: 1000, limit: 200 },
    ]);
    expect(store.getState().activityRuns).toEqual({ total: 1500, fetched: 1200, hasMore: true });
  });

  it("a failed refetch keeps the loaded runs and their paging", async () => {
    answerPages({ ...NO_ROWS, counts: COUNTS });
    listActivityRunSessions.mockResolvedValueOnce({ sessions: [run("run_a")], total: 30 });
    const store = createSessionsStore();
    store.setState({ projectId: "proj", agentIds: ["default_agent"] });
    await store.getState().reload();
    listActivityRunSessions.mockRejectedValueOnce(new Error("offline"));
    await store.getState().reload();
    expect(store.getState().sessions.map((s) => s.sessionId)).toContain("run_a");
    expect(store.getState().activityRuns).toEqual({ total: 30, fetched: 1, hasMore: true });
  });
});
