import { describe, expect, it, vi } from "vitest";
import type { PipelineState } from "@prismshadow/penguin-server/api";
import {
  stagesHistoryReader,
  type StagesHistoryAnswer,
} from "../src/features/activities/stages-history";

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

/** A tick whose other reads succeeded: the page sets the history it was given. */
async function landed(answer: Promise<StagesHistoryAnswer | null>) {
  const value = await answer;
  value?.landed();
  return value?.pipelines ?? null;
}

describe("the stages' history as the poll reads it", () => {
  it("reads it with the first read, not waiting on the current sequence", async () => {
    const history = [sequence("p1", "succeeded")];
    const load = vi.fn(async () => ({ pipelines: history }));
    const read = stagesHistoryReader(load);
    let answer!: (value: { pipeline: PipelineState | null }) => void;
    const reading = read(new Promise((resolve) => (answer = resolve)));
    expect(load).toHaveBeenCalledTimes(1);
    answer({ pipeline: history[0]! });
    expect(await landed(reading)).toBe(history);
  });

  it("reads it again only once the current sequence's id or status moved", async () => {
    const load = vi.fn(async () => ({ pipelines: [] }));
    const read = stagesHistoryReader(load);
    await landed(read(current(null)));
    // Nothing ran: every later tick leaves the history as it was.
    expect(await read(current(null))).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
    // A sequence starts, works through its steps, and settles.
    expect(await landed(read(current(sequence("p1", "running"))))).toEqual([]);
    expect(load).toHaveBeenCalledTimes(2);
    await landed(read(current({ ...sequence("p1", "running"), currentRunId: "run_2" })));
    expect(load).toHaveBeenCalledTimes(2);
    await landed(read(current(sequence("p1", "succeeded"))));
    expect(load).toHaveBeenCalledTimes(3);
    await landed(read(current(sequence("p1", "succeeded"))));
    expect(load).toHaveBeenCalledTimes(3);
    // The next one starts.
    await landed(read(current(sequence("p2", "running"))));
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
    expect(await landed(read(current(pipelines[0]!)))).toBeNull();
    expect(await landed(read(current(pipelines[0]!)))).toBeNull();
    expect(await landed(read(current(pipelines[0]!)))).toBe(pipelines);
    // So is a read after a move: it is tried until it lands.
    expect(await landed(read(current(sequence("p2", "running"))))).toBeNull();
    expect(await landed(read(current(sequence("p2", "running"))))).toBe(pipelines);
    expect(await landed(read(current(sequence("p2", "running"))))).toBeNull();
    expect(load).toHaveBeenCalledTimes(5);
  });

  it("reads it again on the next tick when the page never set what it read", async () => {
    const load = vi.fn(async () => ({ pipelines: [] }));
    const read = stagesHistoryReader(load);
    // Another read of the first tick failed, so the page dropped the history with it.
    expect(await read(current(null))).not.toBeNull();
    expect(await landed(read(current(null)))).toEqual([]);
    expect(load).toHaveBeenCalledTimes(2);
    expect(await read(current(null))).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
    // The same on the tick where a sequence starts.
    expect(await read(current(sequence("p1", "running")))).not.toBeNull();
    expect(await landed(read(current(sequence("p1", "running"))))).toEqual([]);
    expect(load).toHaveBeenCalledTimes(4);
    expect(await read(current(sequence("p1", "running")))).toBeNull();
    expect(load).toHaveBeenCalledTimes(4);
  });

  it("leaves the history standing while the current sequence is unknown", async () => {
    const load = vi.fn(async () => ({ pipelines: [] }));
    const read = stagesHistoryReader(load);
    // Read beside an unknown sequence, the history is read again once the sequence is known.
    await landed(read(Promise.resolve(null)));
    await landed(read(current(sequence("p1", "running"))));
    expect(load).toHaveBeenCalledTimes(2);
    // Without the current sequence there is no telling whether the history moved.
    expect(await read(Promise.resolve(null))).toBeNull();
    expect(await read(current(sequence("p1", "running")))).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
