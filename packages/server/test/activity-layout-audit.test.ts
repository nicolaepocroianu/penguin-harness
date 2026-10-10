/**
 * The layout audit of a scene composition. What this proves: the measured moments are spread from
 * the first frame to the last; each thing the page reports is found once, with the elements it is
 * about and the stretch it was seen for; and an answer that is not a measurement is ignored.
 */
import { describe, expect, it } from "vitest";
import { AUDIT_SAMPLES, auditFrames, layoutFindings } from "../src/activities/layout-audit.js";

describe("layout audit", () => {
  it("measures the first frame, the last, and evenly between", () => {
    expect([...auditFrames(361)]).toEqual([0, 90, 180, 270, 360]);
    expect(auditFrames(3).size).toBeLessThanOrEqual(AUDIT_SAMPLES);
    expect([...auditFrames(1)]).toEqual([0]);
    expect(auditFrames(0).size).toBe(0);
  });

  it("finds each thing once, with its elements and when it was seen", () => {
    const sample = (overlap: string[][], offStage: string[] = [], smallText: string[] = []) => ({
      overlap,
      offStage,
      smallText,
    });
    expect(
      layoutFindings([
        { atMs: 0, sample: sample([["#palm", "#chest"]], [], ["#label"]) },
        { atMs: 3000, sample: sample([["#chest", "#palm"]], ["#sun"]) },
        { atMs: 6000, sample: true },
        { atMs: 9000, sample: sample([["#chest", "#palm"]]) },
      ]),
    ).toEqual([
      {
        code: "layout_overlap",
        severity: "warning",
        elements: ["#chest", "#palm"],
        startMs: 0,
        endMs: 9000,
      },
      { code: "small_text", severity: "warning", elements: ["#label"], startMs: 0, endMs: 0 },
      { code: "off_stage", severity: "warning", elements: ["#sun"], startMs: 3000, endMs: 3000 },
    ]);
    expect(layoutFindings([{ atMs: 0, sample: null }])).toEqual([]);
  });
});
