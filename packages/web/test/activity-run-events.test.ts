/**
 * The user channel hands an activity run's end to the activity list (lib/activity-run-events,
 * routed by state/sessions.tsx applyUserEvent), which re-reads its cards on it instead of
 * polling while a run is in flight.
 */
import { describe, expect, it, vi } from "vitest";
import type { ServerEvent } from "@prismshadow/penguin-server/api";

vi.mock("../src/api/endpoints", () => ({ listSessions: vi.fn() }));

import { subscribeActivityRunFinished } from "../src/lib/activity-run-events";
import { applyUserEvent, createSessionsStore } from "../src/state/sessions";

const finished: ServerEvent = {
  type: "activity_run_finished",
  projectId: "proj",
  activityId: "act_1",
  runId: "run_1",
  status: "succeeded",
};

describe("activity_run_finished on the user channel", () => {
  it("reaches every listener until it unsubscribes, and leaves the session list alone", () => {
    const store = createSessionsStore();
    const reload = vi.spyOn(store.getState(), "reload");
    const heard: ServerEvent[] = [];
    const unsubscribe = subscribeActivityRunFinished((event) => heard.push(event));
    applyUserEvent(store, finished, () => {});
    expect(heard).toEqual([finished]);
    expect(reload).not.toHaveBeenCalled();
    unsubscribe();
    applyUserEvent(store, finished, () => {});
    expect(heard).toHaveLength(1);
  });
});
