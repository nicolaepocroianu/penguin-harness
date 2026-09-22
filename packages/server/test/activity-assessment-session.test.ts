import { describe, expect, it } from "vitest";
import {
  AssessmentSessions,
  assessmentProblems,
  scoreItem,
  summarize,
  type AssessmentItem,
} from "../src/activities/assessment-session.js";

const single: AssessmentItem = {
  id: "q1",
  interaction: "SIMPLE_CHOICE",
  choices: [
    { id: "a", isCorrect: true },
    { id: "b", isCorrect: false },
  ],
};

const multiple: AssessmentItem = {
  id: "q2",
  interaction: "MULTIPLE_RESPONSE_CHOICE",
  choices: [
    { id: "a", isCorrect: true },
    { id: "b", isCorrect: true },
    { id: "c", isCorrect: false },
  ],
};

function clock(start = 1_000_000) {
  let at = start;
  return {
    now: () => at,
    advance(ms: number) {
      at += ms;
    },
  };
}

describe("what makes an assessment answerable", () => {
  it("accepts Loom's two interaction kinds when their rules hold", () => {
    expect(assessmentProblems([single, multiple])).toEqual([]);
  });

  it("needs at least two choices", () => {
    expect(
      assessmentProblems([
        { id: "q", interaction: "SIMPLE_CHOICE", choices: [{ id: "a", isCorrect: true }] },
      ]),
    ).toEqual(["Item 1 needs at least two choices."]);
  });

  it("needs exactly one correct choice for a single-choice item", () => {
    const two = { ...single, choices: single.choices.map((c) => ({ ...c, isCorrect: true })) };
    expect(assessmentProblems([two])).toContain(
      "Item 1 is a single choice, so it needs exactly one correct choice.",
    );
    const none = { ...single, choices: single.choices.map((c) => ({ ...c, isCorrect: false })) };
    expect(assessmentProblems([none])).toContain(
      "Item 1 is a single choice, so it needs exactly one correct choice.",
    );
  });

  it("needs at least one correct choice for a multiple-response item", () => {
    const none = {
      ...multiple,
      choices: multiple.choices.map((c) => ({ ...c, isCorrect: false })),
    };
    expect(assessmentProblems([none])).toContain("Item 1 needs at least one correct choice.");
  });

  it("names a repeated item id and a repeated choice id", () => {
    expect(assessmentProblems([single, { ...single }])).toContain('Item 2 repeats the id "q1".');
    expect(
      assessmentProblems([
        {
          id: "q",
          interaction: "SIMPLE_CHOICE",
          choices: [
            { id: "a", isCorrect: true },
            { id: "a", isCorrect: false },
          ],
        },
      ]),
    ).toContain('Item 1 repeats the choice id "a".');
  });

  it("names an empty id rather than accepting a blank", () => {
    expect(assessmentProblems([{ ...single, id: "  " }])).toContain("Item 1 has no id.");
  });
});

describe("scoring", () => {
  it("marks a single choice right only for the correct one", () => {
    expect(scoreItem(single, ["a"])).toBe(true);
    expect(scoreItem(single, ["b"])).toBe(false);
  });

  it("marks a single choice wrong when more than one is picked", () => {
    expect(scoreItem(single, ["a", "b"])).toBe(false);
    expect(scoreItem(single, [])).toBe(false);
  });

  it("needs the exact set for a multiple-response item", () => {
    expect(scoreItem(multiple, ["a", "b"])).toBe(true);
    expect(scoreItem(multiple, ["b", "a"])).toBe(true);
  });

  it("does not let picking everything count as right", () => {
    // The rule a hand-rolled scorer usually gets wrong.
    expect(scoreItem(multiple, ["a", "b", "c"])).toBe(false);
  });

  it("marks a partial answer wrong", () => {
    expect(scoreItem(multiple, ["a"])).toBe(false);
    expect(scoreItem(multiple, [])).toBe(false);
  });
});

describe("a learner session", () => {
  it("opens, records answers and reports a score", () => {
    const c = clock();
    const sessions = new AssessmentSessions(c.now);
    sessions.open("score-1", "act-1", [single, multiple]);
    expect(sessions.respond("score-1", "q1", ["a"]).correct).toBe(true);
    expect(sessions.respond("score-1", "q2", ["a"]).correct).toBe(false);
    expect(summarize(sessions.get("score-1")!)).toEqual({
      scoreId: "score-1",
      answered: 2,
      total: 2,
      correct: 1,
      finished: false,
    });
  });

  it("replaces an answer rather than scoring the learner twice", () => {
    const c = clock();
    const sessions = new AssessmentSessions(c.now);
    sessions.open("s", "act-1", [single]);
    sessions.respond("s", "q1", ["b"]);
    sessions.respond("s", "q1", ["a"]);
    expect(summarize(sessions.get("s")!)).toMatchObject({ answered: 1, correct: 1 });
  });

  it("refuses an assessment that could not be answered coherently", () => {
    const sessions = new AssessmentSessions(clock().now);
    expect(() =>
      sessions.open("s", "act-1", [
        { id: "q", interaction: "SIMPLE_CHOICE", choices: [{ id: "a", isCorrect: true }] },
      ]),
    ).toThrow(/at least two choices/);
  });

  it("refuses a response to an item or a choice it does not have", () => {
    const sessions = new AssessmentSessions(clock().now);
    sessions.open("s", "act-1", [single]);
    expect(() => sessions.respond("s", "nope", ["a"])).toThrow(/no item "nope"/);
    expect(() => sessions.respond("s", "q1", ["z"])).toThrow(/no choice z/);
  });

  it("refuses a response to a score that was never opened", () => {
    const sessions = new AssessmentSessions(clock().now);
    expect(() => sessions.respond("ghost", "q1", ["a"])).toThrow(/No open score ghost/);
  });

  it("takes no more responses once finished", () => {
    const sessions = new AssessmentSessions(clock().now);
    sessions.open("s", "act-1", [single]);
    expect(sessions.finish("s")).toMatchObject({ finished: true, answered: 0 });
    expect(() => sessions.respond("s", "q1", ["a"])).toThrow(/already finished/);
  });

  it("finishes twice without complaint, since a runtime may exit fast", () => {
    const c = clock();
    const sessions = new AssessmentSessions(c.now);
    sessions.open("s", "act-1", [single]);
    const first = sessions.finish("s");
    c.advance(5_000);
    expect(sessions.finish("s")).toEqual(first);
  });
});

describe("forgetting old sessions", () => {
  it("drops a session nobody has touched inside the TTL", () => {
    const c = clock();
    const sessions = new AssessmentSessions(c.now, 1_000);
    sessions.open("s", "act-1", [single]);
    c.advance(1_001);
    expect(sessions.get("s")).toBeNull();
    expect(sessions.size()).toBe(0);
  });

  it("keeps a session alive while it is being used", () => {
    const c = clock();
    const sessions = new AssessmentSessions(c.now, 1_000);
    sessions.open("s", "act-1", [single]);
    for (let step = 0; step < 5; step += 1) {
      c.advance(900);
      expect(sessions.get("s")).not.toBeNull();
    }
  });

  it("reports how many it dropped", () => {
    const c = clock();
    const sessions = new AssessmentSessions(c.now, 1_000);
    sessions.open("a", "act-1", [single]);
    sessions.open("b", "act-1", [single]);
    c.advance(1_001);
    expect(sessions.sweep()).toBe(2);
    expect(sessions.sweep()).toBe(0);
  });

  it("keeps separate scores separate", () => {
    const c = clock();
    const sessions = new AssessmentSessions(c.now, 10_000);
    sessions.open("a", "act-1", [single]);
    sessions.open("b", "act-1", [single]);
    sessions.respond("a", "q1", ["a"]);
    expect(summarize(sessions.get("a")!)).toMatchObject({ answered: 1 });
    expect(summarize(sessions.get("b")!)).toMatchObject({ answered: 0 });
  });
});
