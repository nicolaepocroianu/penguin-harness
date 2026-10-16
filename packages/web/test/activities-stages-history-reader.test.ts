import { describe, expect, it, vi } from "vitest";
import type { PipelineState } from "@prismshadow/penguin-server/api";
import { stagesHistoryReader } from "../src/features/activities/stages-history";

function sequence(pipelineId: string, status: PipelineState["status"]): PipelineState {
  return {
    pipelineId,
    projectId: "proj",
    activityId: "act",
    selection: "all",
    scope: null,
    status,
    steps: [],
    currentRunId: null,
    currentSessionId: null,
    error: null,
    startedAt: "2026-10-16T10:00:00Z",
    finishedAt: null,
  };
}

/** The current sequence's read as the poll hands it over: null when the read failed. */
const current = (pipeline: PipelineState | null) => Promise.resolve({ pipeline });

describe("the stages' history as the poll reads it", () => {
  it("reads it with the first read, not waiting on the current sequence", async () => {
    const history = [sequence("p1", "succeeded")];
    const load = vi.fn(async () => ({ pipelines: history }));
    const read = stagesHistoryReader(load);
    let answer!: (value: { pipeline: PipelineState | null }) => void;
    const reading = read(new Promise((resolve) => (answer = resolve)));
    expect(load).toHaveBeenCalledTimes(1);
    answer({ pipeline: history[0]! });
    expect(await reading).toBe(history);
  });

  it("reads it again only once the current sequence's id or status moved", async () => {
    const load = vi.fn(async () => ({ pipelines: [] }));
    const read = stagesHistoryReader(load);
    await read(current(null));
    // Nothing ran: every later tick leaves the history as it was.
    expect(await read(current(null))).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
    // A sequence starts, works through its steps, and settles.
    expect(await read(current(sequence("p1", "running")))).toEqual([]);
    expect(load).toHaveBeenCalledTimes(2);
    await read(current({ ...sequence("p1", "running"), currentRunId: "run_2" }));
    expect(load).toHaveBeenCalledTimes(2);
    await read(current(sequence("p1", "succeeded")));
    expect(load).toHaveBeenCalledTimes(3);
    await read(current(sequence("p1", "succeeded")));
    expect(load).toHaveBeenCalledTimes(3);
    // The next one starts.
    await read(current(sequence("p2", "running")));
    expect(load).toHaveBeenCalledTimes(4);
  });

  it("tries a failed read again on the next tick", async () => {
    const pipelines = [sequence("p1", "succeeded")];
    const load = vi
      .fn<() => Promise<{ pipelines: PipelineState[] }>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({} as { pipelines: PipelineState[] })
      .mockResolvedValueOnce({ pipelines })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ pipelines });
    const read = stagesHistoryReader(load);
    // A first read that failed, or answered without a history, is a first read again.
    expect(await read(current(pipelines[0]!))).toBeNull();
    expect(await read(current(pipelines[0]!))).toBeNull();
    expect(await read(current(pipelines[0]!))).toBe(pipelines);
    // So is a read after a move: it is tried until it lands.
    expect(await read(current(sequence("p2", "running")))).toBeNull();
    expect(await read(current(sequence("p2", "running")))).toBe(pipelines);
    expect(await read(current(sequence("p2", "running")))).toBeNull();
    expect(load).toHaveBeenCalledTimes(5);
  });

  it("leaves the history standing while the current sequence is unknown", async () => {
    const load = vi.fn(async () => ({ pipelines: [] }));
    const read = stagesHistoryReader(load);
    // Read beside an unknown sequence, the history is read again once the sequence is known.
    await read(Promise.resolve(null));
    await read(current(sequence("p1", "running")));
    expect(load).toHaveBeenCalledTimes(2);
    // Without the current sequence there is no telling whether the history moved.
    expect(await read(Promise.resolve(null))).toBeNull();
    expect(await read(current(sequence("p1", "running")))).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
