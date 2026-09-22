import { describe, expect, it } from "vitest";
import {
  allTranslationTargets,
  describeTranslationPlan,
  languagesInPlan,
  planTranslation,
  translationRecord,
  translationRequests,
  type ExistingTranslation,
  type SourceScript,
} from "../src/activities/translation.js";

const sources: SourceScript[] = [
  { key: "intro", script: "Hello there" },
  { key: "outro", script: "Goodbye" },
];

const existing = (
  key: string,
  language: string,
  script: string,
  translatedFrom?: string,
): ExistingTranslation => ({
  key,
  language,
  script,
  ...(translatedFrom ? { translatedFrom } : {}),
});

describe("planning a translation", () => {
  it("wants every target language for a script never translated", () => {
    const plan = planTranslation(sources, [], ["en-US", "es-MX", "ro-RO"]);
    expect(plan.needed).toHaveLength(4);
    expect(plan.needed.every((need) => need.kind === "missing")).toBe(true);
  });

  it("never translates into the default language", () => {
    const plan = planTranslation(sources, [], ["en-US"]);
    expect(plan.needed).toEqual([]);
  });

  it("ignores a language this product does not support", () => {
    const plan = planTranslation(sources, [], ["en-US", "fr-FR"]);
    expect(plan.needed).toEqual([]);
  });

  it("skips a source with nothing to say", () => {
    // An empty line translates to an empty line; asking a model spends a call to learn
    // nothing.
    const plan = planTranslation([{ key: "quiet", script: "   " }], [], ["es-MX"]);
    expect(plan.needed).toEqual([]);
  });

  it("leaves a current translation alone", () => {
    const plan = planTranslation(
      sources,
      [existing("intro", "es-MX", "Hola", "Hello there")],
      ["es-MX"],
    );
    expect(plan.current).toEqual([{ key: "intro", language: "es-MX" }]);
    expect(plan.needed.some((need) => need.key === "intro")).toBe(false);
  });

  it("wants a translation again when its source line was rewritten, and says both", () => {
    const plan = planTranslation(
      [{ key: "intro", script: "Good morning" }],
      [existing("intro", "es-MX", "Hola", "Hello there")],
      ["es-MX"],
    );
    expect(plan.needed).toEqual([
      { kind: "stale", key: "intro", language: "es-MX", was: "Hello there", now: "Good morning" },
    ]);
  });

  it("treats a translation with no remembered source as current rather than guessing", () => {
    const plan = planTranslation(sources, [existing("intro", "es-MX", "Hola")], ["es-MX"]);
    expect(plan.current).toHaveLength(1);
  });

  it("reports a translation whose script no longer exists", () => {
    const plan = planTranslation(sources, [existing("ghost", "es-MX", "Hola", "x")], ["es-MX"]);
    expect(plan.orphaned).toEqual([{ key: "ghost", language: "es-MX" }]);
    // Not counted as needing translation: there is nothing to translate from.
    expect(plan.needed.some((need) => need.key === "ghost")).toBe(false);
  });

  it("counts a partly translated activity correctly", () => {
    const plan = planTranslation(
      sources,
      [existing("intro", "es-MX", "Hola", "Hello there")],
      ["es-MX", "ro-RO"],
    );
    expect(plan.current).toHaveLength(1);
    expect(plan.needed).toHaveLength(3);
  });
});

describe("the requests a plan makes", () => {
  it("names the language a translator would recognise, not the code", () => {
    const plan = planTranslation(sources, [], ["es-MX"]);
    const requests = translationRequests(sources, plan);
    expect(requests[0]!.languageName).toBe("Mexican Spanish");
  });

  it("carries the script to translate", () => {
    const plan = planTranslation(sources, [], ["es-MX"]);
    const requests = translationRequests(sources, plan);
    expect(requests.find((request) => request.key === "intro")!.script).toBe("Hello there");
  });

  it("orders by key then language, so a partial run can be resumed", () => {
    const plan = planTranslation(sources, [], ["ro-RO", "es-MX"]);
    expect(
      translationRequests(sources, plan).map((request) => `${request.key}/${request.language}`),
    ).toEqual(["intro/es-MX", "intro/ro-RO", "outro/es-MX", "outro/ro-RO"]);
  });

  it("makes a request for a stale translation too", () => {
    const plan = planTranslation(
      [{ key: "intro", script: "Good morning" }],
      [existing("intro", "es-MX", "Hola", "Hello there")],
      ["es-MX"],
    );
    const requests = translationRequests([{ key: "intro", script: "Good morning" }], plan);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.script).toBe("Good morning");
  });
});

describe("what a finished translation records", () => {
  it("keeps the source it was translated from", () => {
    // Without it nothing can later tell a translation that is still true from one whose
    // English was rewritten, and the activity says different things in different languages.
    const plan = planTranslation(sources, [], ["es-MX"]);
    const request = translationRequests(sources, plan)[0]!;
    expect(translationRecord(request, "Hola")).toEqual({
      key: "intro",
      language: "es-MX",
      script: "Hola",
      translatedFrom: "Hello there",
    });
  });

  it("produces a record the planner then treats as current", () => {
    const plan = planTranslation(sources, [], ["es-MX"]);
    const request = translationRequests(sources, plan)[0]!;
    const record = translationRecord(request, "Hola");
    const after = planTranslation(sources, [record], ["es-MX"]);
    expect(after.current).toContainEqual({ key: "intro", language: "es-MX" });
  });
});

describe("what an author is told", () => {
  it("keeps never-translated apart from source-changed", () => {
    // One is work not done; the other is work that must be done again because the English
    // moved. Collapsing them hides why.
    const plan = planTranslation(
      [
        { key: "intro", script: "Good morning" },
        { key: "outro", script: "Goodbye" },
      ],
      [existing("intro", "es-MX", "Hola", "Hello there")],
      ["es-MX"],
    );
    const message = describeTranslationPlan(plan);
    expect(message).toContain("1 never translated");
    expect(message).toContain("1 whose source line changed");
  });

  it("says so when everything is translated", () => {
    const plan = planTranslation(
      [{ key: "intro", script: "Hello there" }],
      [existing("intro", "es-MX", "Hola", "Hello there")],
      ["es-MX"],
    );
    expect(describeTranslationPlan(plan)).toBe("Every script is translated. 1 already current.");
  });

  it("mentions translations with nothing left to match", () => {
    const plan = planTranslation([], [existing("ghost", "es-MX", "Hola", "x")], ["es-MX"]);
    expect(describeTranslationPlan(plan)).toContain("1 translation has no script left to match");
  });
});

describe("helpers", () => {
  it("lists the languages a plan touches, sorted", () => {
    const plan = planTranslation(sources, [], ["ro-RO", "es-MX"]);
    expect(languagesInPlan(plan)).toEqual(["es-MX", "ro-RO"]);
  });

  it("offers every target when an author asks to translate everything", () => {
    expect(allTranslationTargets()).toEqual(["es-MX", "ro-RO"]);
  });
});
