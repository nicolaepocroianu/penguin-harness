/**
 * The user channel tells the activity list when it may be stale (lib/activity-run-events,
 * routed by state/sessions.tsx applyUserEvent): a run finished in a Project, or the stream lost
 * events it cannot replay. The list re-reads its cards on either instead of polling while a run
 * is in flight.
 */
import { describe, expect, it, vi } from "vitest";
import type { ServerEvent } from "@prismshadow/penguin-server/api";

vi.mock("../src/api/endpoints", () => ({ listSessions: vi.fn() }));

import { subscribeActivityListStale } from "../src/lib/activity-run-events";
import { applyUserEvent, createSessionsStore } from "../src/state/sessions";

const finished: ServerEvent = {
  type: "activity_run_finished",
  projectId: "proj",
  activityId: "act_1",
  runId: "run_1",
  status: "succeeded",
};

describe("the activity list hears when it may be stale", () => {
  it("names the Project a run finished in, until the listener unsubscribes, and leaves the session list alone", () => {
    const store = createSessionsStore();
    const reload = vi.spyOn(store.getState(), "reload");
    const heard: (string | null)[] = [];
    const unsubscribe = subscribeActivityListStale((projectId) => heard.push(projectId));
    applyUserEvent(store, finished, () => {});
    expect(heard).toEqual(["proj"]);
    expect(reload).not.toHaveBeenCalled();
    unsubscribe();
    applyUserEvent(store, finished, () => {});
    expect(heard).toHaveLength(1);
  });

  it("says any Project may be stale when the stream lost events, since a finish may be among them", () => {
    const store = createSessionsStore();
    const heard: (string | null)[] = [];
    const unsubscribe = subscribeActivityListStale((projectId) => heard.push(projectId));
    applyUserEvent(store, { type: "resync_required" }, () => {});
    expect(heard).toEqual([null]);
    unsubscribe();
  });
});
