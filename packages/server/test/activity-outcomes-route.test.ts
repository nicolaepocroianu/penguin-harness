/**
 * The outcome ledger's admin read route: who may read it, what it refuses, and that it answers
 * with the ledger's own tallies and histories.
 */
import { afterEach, describe, expect, it } from "vitest";
import { newId, type ActivityDetail, type ActivityRun } from "../src/activities/domain.js";
import type {
  OutcomeHistoryResponse,
  OutcomeTallyResponse,
} from "../src/activities/outcome-types.js";
import type { ActivityOutcomes } from "../src/activities/outcomes.js";
import type { ActivityRuns } from "../src/activities/run-store.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";

const PROJECT = "ledger";
const ROUTE = "/api/admin/activity-outcomes";

describe("the outcome ledger's read route", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function fixture() {
    const t = await createTestApp({
      activityOutcomePorts: {
        library: () => [],
        build: () => ({ penguin: "9.9.9", commit: null }),
      },
    });
    cleanups.push(t.cleanup);
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    expect((await admin.post("/api/projects", { projectId: PROJECT })).status).toBe(201);
    const activity = (await (
      await admin.post(`/api/projects/${PROJECT}/activities`, {
        productCode: "p",
        refNum: 1,
        title: "One",
      })
    ).json()) as ActivityDetail;
    const api = <T>(name: string) => t.deps.tree.api<T>("ActivitiesModule", name);
    const runs = api<ActivityRuns>("ActivityRuns");
    const outcomes = api<ActivityOutcomes>("ActivityOutcomes");
    // A spec run whose agent started and that succeeded, as the engine shows it to the ledger.
    const run = {
      kind: "spec",
      runId: newId("run"),
      activityId: activity.id,
      projectId: PROJECT,
      draftId: activity.draft.draftId,
      inputRevision: activity.draft.contentRevision,
      agentId: "default_agent",
      sessionId: null,
      status: "running",
      createdAt: "2026-10-13T10:00:00.000Z",
      finishedAt: null,
      error: null,
      candidate: null,
    } as ActivityRun;
    runs.open(run);
    outcomes.witness({ run });
    outcomes.witness({ run, prompt: "Write it.", session: { provider: "custom", modelId: "m" } });
    const settled = { ...run, status: "succeeded", finishedAt: "2026-10-13T10:01:00.000Z" };
    runs.save(settled as ActivityRun);
    outcomes.witness({ run: settled as ActivityRun });
    return { t, admin, activity, run };
  }

  it("answers an admin with the ledger's tallies and an activity's runs", async () => {
    const { admin, activity, run } = await fixture();
    const tally = await admin.get(`${ROUTE}/tally?kind=spec&by=runtime`);
    expect(tally.status).toBe(200);
    expect(((await tally.json()) as OutcomeTallyResponse).tallies).toEqual([
      {
        key: "agent:custom/m",
        recipe: null,
        runs: 1,
        metrics: { succeeded: 1, seconds: 60 },
      },
    ]);
    // Narrowed by project, activity and time.
    const narrowed = async (query: string) =>
      (
        (await (
          await admin.get(`${ROUTE}/tally?kind=spec&${query}`)
        ).json()) as OutcomeTallyResponse
      ).tallies.length;
    expect(await narrowed(`projectId=${PROJECT}&activityId=${activity.id}`)).toBe(1);
    expect(await narrowed("projectId=elsewhere")).toBe(0);
    expect(await narrowed("activityId=act_other&activityId=act_another")).toBe(0);
    expect(await narrowed("since=2026-10-13T10:00:00Z&until=2026-10-13T11:00:00Z")).toBe(1);
    expect(await narrowed("since=2026-10-14T00:00:00Z")).toBe(0);

    const history = await admin.get(
      `${ROUTE}/history?projectId=${PROJECT}&activityId=${activity.id}`,
    );
    expect(history.status).toBe(200);
    const { runs } = (await history.json()) as OutcomeHistoryResponse;
    expect(runs).toMatchObject([
      {
        runId: run.runId,
        kind: "spec",
        recipe: { runtime: "agent:custom/m", library: [], penguin: "9.9.9" },
      },
    ]);
    expect(runs[0]!.facts.map((fact) => fact.fact)).toEqual(["opened", "started", "settled"]);
    const one = await admin.get(
      `${ROUTE}/history?projectId=${PROJECT}&activityId=${activity.id}&runId=${run.runId}`,
    );
    expect(((await one.json()) as OutcomeHistoryResponse).runs).toHaveLength(1);
  });

  it("is for admins only, even the project's own owner", async () => {
    const { t } = await fixture();
    const member = apiClient(t.app, (await provisionUser(t.app, "outcomes_owner")).cookie);
    expect((await member.post("/api/projects", { projectId: "outcomes_owner-work" })).status).toBe(
      201,
    );
    for (const path of ["tally?kind=spec", "history?projectId=outcomes_owner-work&activityId=a"]) {
      const response = await member.get(`${ROUTE}/${path}`);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "admin_required" } });
    }
  });

  it("refuses a query it cannot answer", async () => {
    const { admin } = await fixture();
    const refused = async (path: string) => {
      const response = await admin.get(`${ROUTE}/${path}`);
      return { status: response.status, body: (await response.json()) as unknown };
    };
    for (const path of [
      "tally",
      "tally?kind=nonsense",
      "tally?kind=spec&by=colour",
      "tally?kind=spec&projectId=../etc",
      "tally?kind=spec&activityId=a/b",
      "tally?kind=spec&since=yesterday",
      "history?activityId=act_1",
      "history?projectId=p",
      "history?projectId=p&activityId=a&runId=../x",
    ])
      expect(await refused(path), path).toMatchObject({
        status: 400,
        body: { error: { code: "bad_request" } },
      });
  });
});
