/**
 * The Stages panel keeps its history: the server's record of every sequence reaches the panel,
 * which lists the earlier ones under the latest, each named by what it ran and when.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PipelineState } from "@prismshadow/penguin-server/api";
import { PipelinePanel, stepSessions } from "../src/features/activities/pipeline-panel";
import { formatDateTime } from "../src/lib/format";
import { S } from "../src/lib/strings";

function sequence(pipelineId: string, over: Partial<PipelineState> = {}): PipelineState {
  return {
    pipelineId,
    projectId: "proj",
    activityId: "act",
    selection: "all",
    scope: null,
    status: "succeeded",
    steps: [
      {
        step: "spec",
        status: "succeeded",
        detail: null,
        note: null,
        done: 0,
        total: 0,
        runIds: [],
      },
    ],
    currentRunId: null,
    currentSessionId: null,
    error: null,
    startedAt: "2026-10-09T10:00:00.000Z",
    finishedAt: "2026-10-09T10:05:00.000Z",
    ...over,
  };
}

const render = (pipeline: PipelineState | null, history: PipelineState[]) =>
  renderToStaticMarkup(
    createElement(PipelinePanel, {
      pipeline,
      history,
      runs: [],
      agentLabel: "Activity Agent",
      onAddExcerpt: () => undefined,
    }),
  );

describe("the Stages panel's history", () => {
  const words = S.activities.studioRun;

  it("lists the earlier sequences under the latest, without repeating the latest", () => {
    const latest = sequence("p3", { startedAt: "2026-10-10T09:00:00.000Z" });
    const earlier = [
      sequence("p2", {
        selection: "speech",
        status: "failed",
        startedAt: "2026-10-09T12:00:00.000Z",
      }),
      sequence("p1", { status: "cancelled" }),
    ];
    const html = render(latest, [latest, ...earlier]);
    expect(html).toContain(words.earlier(2));
    expect(html).toContain(
      words.earlierRun(words.steps.speech, formatDateTime("2026-10-09T12:00:00.000Z")),
    );
    expect(html).toContain(words.earlierRun(words.all, formatDateTime("2026-10-09T10:00:00.000Z")));
    expect(html).not.toContain(words.earlierRun(words.all, formatDateTime(latest.startedAt)));
  });

  it("shows no history list while there is only the latest", () => {
    const latest = sequence("p1");
    expect(render(latest, [latest])).not.toContain(words.earlier(0));
  });
});

describe("a stage's conversation", () => {
  it("is found from the step's own record once its run has left the recent runs", () => {
    const earlier = sequence("pipe_old", {
      steps: [
        {
          step: "spec",
          status: "succeeded",
          detail: null,
          note: null,
          done: 0,
          total: 0,
          runIds: ["run_gone"],
          sessionId: "sess_kept",
        },
      ],
    });
    expect(stepSessions(earlier, []).get("spec")).toBe("sess_kept");
  });

  it("falls back to the runs for a sequence recorded before steps kept their session", () => {
    const old = sequence("pipe_old", {
      steps: [
        {
          step: "spec",
          status: "succeeded",
          detail: null,
          note: null,
          done: 0,
          total: 0,
          runIds: ["run_1"],
        },
      ],
    });
    expect(stepSessions(old, [{ runId: "run_1", sessionId: "sess_1" }]).get("spec")).toBe("sess_1");
  });

  it("follows a run's rebuilt session over the one the step recorded", () => {
    const rebuilt = sequence("pipe_old", {
      steps: [
        {
          step: "spec",
          status: "succeeded",
          detail: null,
          note: null,
          done: 0,
          total: 0,
          runIds: ["run_1"],
          sessionId: "sess_removed",
        },
      ],
    });
    expect(stepSessions(rebuilt, [{ runId: "run_1", sessionId: "sess_rebuilt" }]).get("spec")).toBe(
      "sess_rebuilt",
    );
  });
});
