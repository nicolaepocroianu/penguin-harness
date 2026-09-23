/**
 * The assessment service a played preview talks to.
 *
 * Emulated as Loom emulated it: the module's own items, served in order, every answer
 * accepted. What matters is that an assessed activity can be played through to the end
 * and that the session ends where the configuration says it does.
 */
import { describe, expect, it } from "vitest";
import {
  interactionType,
  isAssessmentData,
  nextAssessmentPart,
  startAssessment,
  type AssessmentData,
} from "../src/activities/sandbox-assessment.js";

function ids() {
  let next = 100;
  return () => (next += 1);
}

const data: AssessmentData = {
  configuration: { maxItems: 2, nextItemsSize: 1 },
  items: [
    { title: "one", interactionKey: "simple_choice", configuration: { simpleChoice: [] } },
    { title: "two", configuration: { order: {} } },
    { title: "three", configuration: {} },
  ],
};

describe("an emulated assessment session", () => {
  it("hands out items one part at a time, with fresh ids and the backend's field names", () => {
    const nextId = ids();
    const session = startAssessment("r2phcs03L", data, nextId);
    const part = nextAssessmentPart(session, [], nextId);
    expect(part.status).toBe("IN_PROGRESS");
    expect(part.assessmentKey).toBe("r2phcs03L");
    expect(part.assessmentScoreId).toBe(session.assessmentScoreId);
    const [item] = part.nextItems as Record<string, unknown>[];
    expect(item).toMatchObject({ title: "one", interaction: "SIMPLE_CHOICE" });
    expect(item!.itemConfiguration).toEqual({ simpleChoice: [] });
    expect(item).not.toHaveProperty("configuration");
    expect(typeof item!.itemScoreId).toBe("number");
  });

  it("finishes at the configured maximum, not at the end of the items", () => {
    const nextId = ids();
    const session = startAssessment("key", data, nextId);
    nextAssessmentPart(session, [], nextId);
    const second = nextAssessmentPart(session, [{ item_score_id: 7 }], nextId);
    expect((second.nextItems as unknown[]).length).toBe(1);
    const third = nextAssessmentPart(session, [{ item_score_id: 8 }], nextId);
    expect(third.status).toBe("FINISHED");
    expect(third.nextItems).toEqual([]);
    expect(third.savedItems).toEqual([{ itemId: 8, score: 1 }]);
  });

  it("returns what it could not take as unprocessed rather than dropping it", () => {
    const nextId = ids();
    const session = startAssessment("key", data, nextId);
    const part = nextAssessmentPart(session, [{ answer: "no score id" }], nextId);
    expect(part.nonprocessedItems).toEqual([{ answer: "no score id" }]);
  });

  it("does not change the file it was read from", () => {
    const nextId = ids();
    const session = startAssessment("key", data, nextId);
    nextAssessmentPart(session, [], nextId);
    expect(data.items[0]).toHaveProperty("configuration");
  });

  it("names an interaction by its key, else by the shape of its configuration", () => {
    expect(interactionType({ interactionKey: "match" })).toBe("MATCH");
    expect(interactionType({ configuration: { hotText: {} } })).toBe("HOT_TEXT");
    expect(interactionType({ configuration: {} })).toBe("WEL_ACTIVITY");
    expect(interactionType({ configuration: { unknown: 1 } })).toBe("NONE");
    expect(interactionType(null)).toBe("NONE");
  });

  it("only takes a file that has items", () => {
    expect(isAssessmentData(data)).toBe(true);
    expect(isAssessmentData({ items: "no" })).toBe(false);
    expect(isAssessmentData(null)).toBe(false);
  });
});
