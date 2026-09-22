import { describe, expect, it } from "vitest";
import {
  sceneIds,
  sceneMarkupIssues,
  sceneSetChange,
  specMarkupIssues,
} from "../src/activities/media-markup.js";

const messages = (issues: { message: string }[]) => issues.map((issue) => issue.message);

describe("markup in one scene", () => {
  it("accepts a paired element", () => {
    expect(sceneMarkupIssues("s1", 'Hello <audio key="n">narration</audio> world')).toEqual([]);
  });

  it("accepts a self-closing element", () => {
    expect(sceneMarkupIssues("s1", 'Look <image key="cat" /> here')).toEqual([]);
  });

  it("accepts nesting", () => {
    expect(sceneMarkupIssues("s1", "<audio><image /></audio>")).toEqual([]);
  });

  it("accepts prose with no media at all", () => {
    expect(sceneMarkupIssues("s1", "Just words.")).toEqual([]);
  });

  it("catches an unclosed element and points at where it opened", () => {
    const issues = sceneMarkupIssues("s1", 'One\n<audio key="n">two');
    expect(messages(issues)).toEqual(['"audio" was never closed']);
    expect(issues[0]).toMatchObject({ line: 2, column: 1 });
  });

  it("catches a closing tag that was never opened", () => {
    const issues = sceneMarkupIssues("s1", "words </audio>");
    expect(messages(issues)).toEqual(['closing tag for "audio" was never opened']);
  });

  it("reports a mismatched pair once, not as two mistakes", () => {
    // The open tag is consumed by the mismatch, so the author is told one thing: the
    // closing tag does not match. Adding "audio was never closed" would describe the
    // same mistake twice.
    const issues = sceneMarkupIssues("s1", "<audio></image>");
    expect(messages(issues)).toEqual(['closing tag for "image" does not match the open "audio"']);
  });

  it("catches a closing tag written without its angle bracket", () => {
    // The mistake an LLM makes often enough that Loom has a pattern for it.
    const issues = sceneMarkupIssues("s1", "<audio>hello/audio>");
    expect(messages(issues)).toContain(
      "malformed closing tag for \"audio\"; expected a leading '<'",
    );
  });

  it("is case-insensitive about element names", () => {
    expect(sceneMarkupIssues("s1", "<AUDIO></Audio>")).toEqual([]);
  });

  it("ignores elements that are not media", () => {
    expect(sceneMarkupIssues("s1", "<p>hello</p><strong>hi")).toEqual([]);
  });

  it("reports the right line and column in a multi-line description", () => {
    const issues = sceneMarkupIssues("s1", "line one\nline two </video>\nline three");
    expect(issues[0]).toMatchObject({ line: 2, column: 10 });
  });
});

describe("markup across a specification", () => {
  it("collects issues from every scene", () => {
    const spec = {
      scenes: [
        { id: "b", description: "</audio>" },
        { id: "a", description: "<image>" },
      ],
    };
    expect(specMarkupIssues(spec).map((issue) => issue.sceneId)).toEqual(["a", "b"]);
  });

  it("sorts by scene, line, column and message", () => {
    const spec = {
      scenes: [{ id: "s1", description: "ok </audio>\n</video>" }],
    };
    const issues = specMarkupIssues(spec);
    expect(issues.map((issue) => [issue.line, issue.column])).toEqual([
      [1, 4],
      [2, 1],
    ]);
  });

  it("reads Loom's legacy `stages` key as scenes", () => {
    expect(specMarkupIssues({ stages: [{ id: "s1", description: "</audio>" }] })).toHaveLength(1);
  });

  it("names a scene with no id rather than dropping its issues", () => {
    expect(specMarkupIssues({ scenes: [{ description: "</audio>" }] })[0]!.sceneId).toBe(
      "unknown-scene",
    );
  });

  it("survives a specification with no scenes, or none at all", () => {
    expect(specMarkupIssues({ scenes: [] })).toEqual([]);
    expect(specMarkupIssues({})).toEqual([]);
    expect(specMarkupIssues(null)).toEqual([]);
    expect(specMarkupIssues({ scenes: "nope" })).toEqual([]);
  });

  it("treats a scene with no description as having no markup", () => {
    expect(specMarkupIssues({ scenes: [{ id: "s1" }] })).toEqual([]);
  });
});

describe("the scene set a media pass may not change", () => {
  const before = { scenes: [{ id: "one" }, { id: "two" }] };

  it("allows an enrichment that keeps the scenes", () => {
    expect(sceneSetChange(before, { scenes: [{ id: "one" }, { id: "two" }] })).toBeNull();
  });

  it("allows reordering, which is not the failure being guarded against", () => {
    expect(sceneSetChange(before, { scenes: [{ id: "two" }, { id: "one" }] })).toBeNull();
  });

  it("refuses a dropped scene and names both sets", () => {
    const problem = sceneSetChange(before, { scenes: [{ id: "one" }] });
    expect(problem).toContain("Expected 2 scenes [one, two]");
    expect(problem).toContain("got 1 [one]");
  });

  it("refuses an added scene", () => {
    expect(
      sceneSetChange(before, { scenes: [{ id: "one" }, { id: "two" }, { id: "three" }] }),
    ).toContain("got 3");
  });

  it("refuses a renamed scene, which is the quiet one", () => {
    // Same count, so a length check alone would let this through -- and the module would
    // then be built for a scene the author never wrote.
    expect(sceneSetChange(before, { scenes: [{ id: "one" }, { id: "second" }] })).toContain(
      "changed the scene set",
    );
  });

  it("uses the singular for one scene", () => {
    expect(sceneSetChange({ scenes: [{ id: "one" }] }, { scenes: [] })).toContain(
      "Expected 1 scene [one]",
    );
  });
});

describe("scene ids", () => {
  it("reads them in order from either key", () => {
    expect(sceneIds({ scenes: [{ id: "a" }, { id: "b" }] })).toEqual(["a", "b"]);
    expect(sceneIds({ stages: [{ id: "a" }] })).toEqual(["a"]);
  });

  it("gives a scene with no id an empty id rather than dropping it", () => {
    // Dropping it would make a missing id look like a missing scene.
    expect(sceneIds({ scenes: [{ id: "a" }, {}] })).toEqual(["a", ""]);
  });
});
