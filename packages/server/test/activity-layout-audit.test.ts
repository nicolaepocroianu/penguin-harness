/**
 * The layout audit of a scene composition. What this proves: the measured moments are spread from
 * the first frame to the last; each thing the page reports is found once, with the elements it is
 * about and the stretch it was seen for; an answer that is not a measurement is ignored; and the
 * last recording's findings reach the agent composing again as instructions, only when there are any.
 */
import { describe, expect, it } from "vitest";
import { compositionInput, findingForAgent } from "../src/activities/composition.js";
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

describe("telling the agent what the last recording got wrong", () => {
  const check = {
    status: "pass" as const,
    durationMs: 8200,
    width: 640,
    height: 480,
    fps: 30,
    hasAudio: false,
    meanDb: null,
    peakDb: null,
    findings: [],
  };

  it("words each finding as something to fix, and leaves out what a composition cannot change", () => {
    const told = (finding: Parameters<typeof findingForAgent>[0]) =>
      findingForAgent(finding, check);
    expect(
      told({
        code: "layout_overlap",
        severity: "warning",
        elements: ["#chest", "#palm"],
        startMs: 0,
        endMs: 11500,
      }),
    ).toBe(
      "#chest and #palm cover each other from 0 s to 11.5 s: move them apart without lifting either off the ground it stands on, or mark the one meant to sit over the other with data-allow-overlap.",
    );
    expect(told({ code: "duration_off", severity: "warning" })).toContain(
      "The timeline played for 8.2 s",
    );
    expect(told({ code: "size_off", severity: "error" })).toBeNull();
  });

  it("stages them in the composition's input only when there are any", () => {
    const scene = {
      sceneId: "intro",
      description: "Dawn",
      assetDescription: "The sky",
      width: 640,
      height: 480,
      images: [],
    } as unknown as Parameters<typeof compositionInput>[0];
    const target = {
      language: "en-US",
      assetKey: "v",
      sceneId: "intro",
      width: 640,
      height: 480,
      images: [],
    };
    expect(compositionInput(scene, target)).not.toHaveProperty("previousRecordingFindings");
    expect(compositionInput(scene, target, ["Fix it."]).previousRecordingFindings).toEqual([
      "Fix it.",
    ]);
  });
});
