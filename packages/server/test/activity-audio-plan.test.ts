import { describe, expect, it } from "vitest";
import {
  clipDecision,
  describeNarrationPlan,
  droppedByClip,
  planNarration,
  type NarrationClip,
  type TranslatedClip,
} from "../src/activities/audio-plan.js";

const recorded: NarrationClip = {
  key: "intro",
  script: "Hello there",
  path: "media/audio/en-US/intro.mp3",
  fileExists: true,
  recordedFrom: "Hello there",
};

const translation = (key: string, language: string, translatedFrom?: string): TranslatedClip => ({
  key,
  language,
  ...(translatedFrom ? { translatedFrom } : {}),
});

describe("whether one clip needs recording", () => {
  it("records a clip that has never been recorded", () => {
    expect(clipDecision({ ...recorded, path: undefined }).action).toBe("record");
  });

  it("records when the file is not there", () => {
    expect(clipDecision({ ...recorded, fileExists: false }).action).toBe("record");
  });

  it("records when the script changed", () => {
    const decision = clipDecision({ ...recorded, script: "Goodbye" });
    expect(decision.action).toBe("record");
    expect(decision.reason).toContain("script changed");
  });

  it("keeps a recording that matches its script", () => {
    expect(clipDecision(recorded).action).toBe("keep");
  });

  it("keeps a recording that remembers no script", () => {
    // It may be a file an author uploaded or accepted; replacing it discards a choice.
    const decision = clipDecision({ ...recorded, recordedFrom: undefined });
    expect(decision.action).toBe("keep");
    expect(decision.reason).toContain("remembers no script");
  });

  it("keeps a clip with nothing to say", () => {
    expect(clipDecision({ ...recorded, script: "   " }).action).toBe("keep");
  });
});

describe("what happens to translations", () => {
  it("drops every translation of a line that was rewritten", () => {
    // Otherwise the activity says different things in different languages and nothing
    // in the product notices.
    const plan = planNarration(
      [{ ...recorded, script: "Goodbye" }],
      [translation("intro", "es-MX", "Hello there"), translation("intro", "ro-RO", "Hello there")],
    );
    expect(plan.dropped).toEqual([
      { key: "intro", language: "es-MX" },
      { key: "intro", language: "ro-RO" },
    ]);
    expect(plan.preserved).toEqual([]);
  });

  it("keeps translations when the source line did not change", () => {
    const plan = planNarration([recorded], [translation("intro", "es-MX", "Hello there")]);
    expect(plan.preserved).toEqual([{ key: "intro", language: "es-MX" }]);
    expect(plan.dropped).toEqual([]);
  });

  it("keeps translations when a clip is re-recorded for a missing file", () => {
    // The words did not change, so the translations still stand.
    const plan = planNarration(
      [{ ...recorded, fileExists: false }],
      [translation("intro", "es-MX", "Hello there")],
    );
    expect(plan.record).toEqual(["intro"]);
    expect(plan.dropped).toEqual([]);
    expect(plan.preserved).toHaveLength(1);
  });

  it("drops a translation whose remembered source no longer matches, even if the clip is current", () => {
    // The English clip is fine; the translation was made from an older line.
    const plan = planNarration([recorded], [translation("intro", "es-MX", "An older line")]);
    expect(plan.record).toEqual([]);
    expect(plan.dropped).toEqual([{ key: "intro", language: "es-MX" }]);
  });

  it("keeps a translation that remembers no source rather than guessing", () => {
    const plan = planNarration([recorded], [translation("intro", "es-MX")]);
    expect(plan.preserved).toHaveLength(1);
  });

  it("leaves a translation of a clip that no longer exists alone", () => {
    const plan = planNarration([], [translation("ghost", "es-MX", "anything")]);
    expect(plan.dropped).toEqual([]);
    expect(plan.preserved).toHaveLength(1);
  });
});

describe("grouping what will be dropped", () => {
  it("groups by clip with languages sorted", () => {
    const plan = planNarration(
      [
        { ...recorded, script: "New" },
        { ...recorded, key: "outro", script: "Also new" },
      ],
      [
        translation("outro", "ro-RO", "old"),
        translation("intro", "ro-RO", "Hello there"),
        translation("intro", "es-MX", "Hello there"),
      ],
    );
    expect(droppedByClip(plan)).toEqual([
      { key: "intro", languages: ["es-MX", "ro-RO"] },
      { key: "outro", languages: ["ro-RO"] },
    ]);
  });
});

describe("what an author is told", () => {
  it("states dropped translations as loudly as recordings", () => {
    // Somebody rewriting one English line should learn here that two Spanish clips are
    // about to disappear -- not afterwards.
    const plan = planNarration(
      [{ ...recorded, script: "Goodbye" }],
      [translation("intro", "es-MX", "Hello there"), translation("intro", "ro-RO", "Hello there")],
    );
    const message = describeNarrationPlan(plan);
    expect(message).toContain("Recording 1 clip.");
    expect(message).toContain("Dropping 2 stale translations whose source line changed");
    expect(message).toContain("intro (es-MX, ro-RO)");
  });

  it("uses the singular throughout", () => {
    const plan = planNarration(
      [{ ...recorded, script: "Goodbye" }],
      [translation("intro", "es-MX", "Hello there")],
    );
    expect(describeNarrationPlan(plan)).toContain("Dropping 1 stale translation");
  });

  it("says so plainly when there is nothing to do", () => {
    expect(describeNarrationPlan(planNarration([recorded], []))).toBe(
      "No narration needs recording. 1 already current.",
    );
  });

  it("mentions kept translations so a run reports what survived", () => {
    const plan = planNarration([recorded], [translation("intro", "es-MX", "Hello there")]);
    expect(describeNarrationPlan(plan)).toContain("Keeping 1 translation.");
  });

  it("handles an activity with no narration at all", () => {
    expect(describeNarrationPlan(planNarration([], []))).toBe("No narration needs recording.");
  });
});
