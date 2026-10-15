/**
 * The Stages panel keeps its history: the server's record of every sequence reaches the panel,
 * which lists the earlier ones under the latest, each named by what it ran and when.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  PipelineState,
  PipelineStep,
  PipelineStepStatus,
} from "@prismshadow/penguin-server/api";
import {
  PipelinePanel,
  continueStep,
  stepSessions,
} from "../src/features/activities/pipeline-panel";
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

const render = (
  pipeline: PipelineState | null,
  history: PipelineState[],
  more: { onContinue?: (from: PipelineStep) => void; blocked?: string | null } = {},
) =>
  renderToStaticMarkup(
    createElement(PipelinePanel, {
      pipeline,
      history,
      runs: [],
      agentLabel: "Activity Agent",
      onAddExcerpt: () => undefined,
      ...more,
    }),
  );

/** A sequence's steps, each with how it ended. */
const steps = (...entries: [PipelineStep, PipelineStepStatus][]) =>
  entries.map(([step, status]) => ({
    step,
    status,
    detail: null,
    note: null,
    done: 0,
    total: 0,
    runIds: [],
  }));

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

  it("names a sequence taken up at a stage by that stage", () => {
    const latest = sequence("p2");
    const earlier = sequence("p1", { selection: { from: "images" } });
    expect(render(latest, [latest, earlier])).toContain(
      words.earlierRun(
        words.allFrom(words.steps.images),
        formatDateTime("2026-10-09T10:00:00.000Z"),
      ),
    );
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

describe("taking a sequence up where it stopped", () => {
  const words = S.activities.studioRun;
  const failedAtImages = sequence("p1", {
    status: "failed",
    error: "image broke",
    steps: steps(["speech", "succeeded"], ["images", "failed"], ["module", "cancelled"]),
  });

  it("is at the stage the sequence failed or stopped at", () => {
    expect(continueStep(failedAtImages)).toBe("images");
    const stopped = sequence("p1", {
      status: "cancelled",
      selection: { from: "speech" },
      steps: steps(["speech", "succeeded"], ["images", "cancelled"], ["module", "cancelled"]),
    });
    expect(continueStep(stopped)).toBe("images");
  });

  it("is not offered for a sequence that finished, or that ran only the stages picked", () => {
    expect(continueStep(null)).toBeNull();
    expect(continueStep(sequence("p1"))).toBeNull();
    for (const selection of ["images", "narration", "assets"] as const)
      expect(continueStep({ ...failedAtImages, selection })).toBeNull();
  });

  it("offers Continue where stages can be run, and holds it while they cannot", () => {
    const label = words.continueFrom(words.steps.images);
    const onContinue = () => undefined;
    expect(render(failedAtImages, [failedAtImages], { onContinue })).toContain(label);
    expect(render(failedAtImages, [failedAtImages])).not.toContain(label);
    expect(render(failedAtImages, [failedAtImages], { onContinue, blocked: "Busy." })).toMatch(
      new RegExp(`<button[^>]*disabled[^>]*>${label}</button>`),
    );
  });
});
