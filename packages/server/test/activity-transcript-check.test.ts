/**
 * Narration heard against narration written. What this proves: a transcript that says the script
 * matches it whatever the case and punctuation; skipped and misheard words lower the accuracy and
 * are named in script order; extra words heard do not; punctuation read aloud is found unless the
 * script says that word; and an empty script asks nothing.
 */
import { describe, expect, it } from "vitest";
import { compareTranscript, wordsOf } from "../src/activities/transcript-check.js";

const scripts = ["Each treasure is a letter.", "Listen and find the right letter!"];

describe("transcript check", () => {
  it("reads words without case or punctuation", () => {
    expect(wordsOf("Each treasure — is a LETTER. Don't!")).toEqual([
      "each",
      "treasure",
      "is",
      "a",
      "letter",
      "don't",
    ]);
  });

  it("matches a transcript that says the script", () => {
    expect(
      compareTranscript(" each treasure is a letter, listen and find the right letter.", scripts),
    ).toEqual({ accuracy: 1, missing: [], spokenPunctuation: [] });
  });

  it("names the words skipped or misheard, in order, and ignores extra words", () => {
    expect(
      compareTranscript("Each treasure is a ladder. Um, listen and find the letter.", scripts),
    ).toEqual({ accuracy: 0.82, missing: ["letter", "right"], spokenPunctuation: [] });
  });

  it("finds punctuation read aloud, unless the script says the word", () => {
    expect(
      compareTranscript("Each treasure is a letter dot listen and find the right letter", scripts)
        .spokenPunctuation,
    ).toEqual(["dot"]);
    expect(compareTranscript("Put a dot here", ["Put a dot here."]).spokenPunctuation).toEqual([]);
    expect(compareTranscript("anything", [])).toEqual({
      accuracy: 1,
      missing: [],
      spokenPunctuation: [],
    });
  });
});
