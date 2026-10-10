/**
 * A scene video's critique in the studio. What this proves: a kept critique is read back only
 * when it is one, and only a good critique of the newest recording stops Improve.
 */
import { describe, expect, it } from "vitest";
import { critiqueSettles, parseCritique } from "../src/features/activities/scene-critique-view";

const critique = (score: number, recordingRunId = "run_new") => ({
  recordingRunId,
  scores: { story: 4, layout: 4, readability: 4, motion: 4, learners: 4 },
  score,
  fixes: [],
});

describe("scene critique", () => {
  it("reads a kept critique back, and nothing else", () => {
    expect(parseCritique(JSON.stringify(critique(4.2)))).toEqual(critique(4.2));
    expect(parseCritique("not json")).toBeNull();
    expect(parseCritique(JSON.stringify({ score: 4 }))).toBeNull();
    expect(parseCritique(null)).toBeNull();
  });

  it("stops Improve only for a good critique of the newest recording", () => {
    expect(critiqueSettles(critique(4.2), "run_new")).toBe(true);
    expect(critiqueSettles(critique(3.8), "run_new")).toBe(false);
    // An older recording scored well; the newest one has not been critiqued yet.
    expect(critiqueSettles(critique(4.6, "run_old"), "run_new")).toBe(false);
    expect(critiqueSettles(null, "run_new")).toBe(false);
  });
});
