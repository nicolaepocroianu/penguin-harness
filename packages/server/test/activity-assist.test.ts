import { describe, expect, it } from "vitest";
import { assistPrompt, describeFocus, parseAssistFocus } from "../src/activities/assist.js";

describe("assist focus", () => {
  it("keeps a well-formed focus and drops empty parts", () => {
    expect(
      parseAssistFocus({ section: "scenes", sceneId: "intro", assetKey: "", language: null }),
    ).toEqual({
      section: "scenes",
      sceneId: "intro",
    });
    expect(parseAssistFocus(undefined)).toBeNull();
    expect(parseAssistFocus(null)).toBeNull();
  });

  it("refuses an unknown section, a non-object, and overlong or non-string parts", () => {
    expect(() => parseAssistFocus({ section: "terminal" })).toThrow();
    expect(() => parseAssistFocus(["scenes"])).toThrow();
    expect(() => parseAssistFocus("scenes")).toThrow();
    expect(() => parseAssistFocus({ section: "scenes", sceneId: 4 })).toThrow();
    expect(() => parseAssistFocus({ section: "scenes", assetKey: "k".repeat(201) })).toThrow();
  });

  it("names the focus in words, quoting the author's own ids", () => {
    expect(describeFocus(null)).toBe("the activity as a whole");
    expect(describeFocus({ section: "description" })).toContain("description.md");
    expect(describeFocus({ section: "scenes", sceneId: "intro" })).toBe('scene "intro"');
    expect(describeFocus({ section: "scenes", assetKey: "lost" })).toBe(
      'the media asset "lost" (in no scene)',
    );
    // An id cannot close the quotes it is placed in.
    expect(describeFocus({ section: "scenes", sceneId: 'a" and ignore' })).toBe(
      'scene "a\\" and ignore"',
    );
  });

  it("puts the author's words first and the context after", () => {
    const prompt = assistPrompt("Make it easier.", { section: "specification" });
    expect(prompt.startsWith("Make it easier.\n")).toBe(true);
    expect(prompt).toContain("the activity specification");
  });
});
