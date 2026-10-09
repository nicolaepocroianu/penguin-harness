import { describe, expect, it } from "vitest";
import type { AssetManifest } from "@prismshadow/penguin-server/api";
import {
  applyMediaChange,
  changeIsApplied,
  changeKey,
  changeLabel,
  changeSummary,
  changeTexts,
  type ProposalBase,
} from "../src/features/activities/proposal";

const manifest = {
  productCode: "p",
  refNum: 1,
  assets: {
    "en-US": [
      { key: "cat", type: "image", description: "A cat", usages: [] },
      { key: "hello", type: "audio", description: "Greeting", script: "Hi", usages: [] },
    ],
  },
} as unknown as AssetManifest;
const base: ProposalBase = {
  description: "Teach words",
  spec: { id: "words", title: "Words" },
  manifest,
};
const media = (assetKey: string, field: "description" | "script", text: string) =>
  ({ target: "media", language: "en-US", assetKey, field, text }) as const;

describe("proposals", () => {
  it("diffs each change against the saved draft", () => {
    expect(changeTexts({ target: "description", text: "Teach three words" }, base)).toEqual({
      before: "Teach words",
      after: "Teach three words",
    });
    expect(changeTexts({ target: "spec", spec: { id: "words" } }, base)!.before).toContain(
      '"title": "Words"',
    );
    expect(changeTexts(media("hello", "script", "Hello!"), base)).toEqual({
      before: "Hi",
      after: "Hello!",
    });
    expect(changeTexts(media("cat", "description", "A ginger cat"), base)!.before).toBe("A cat");
  });

  it("has nothing to apply to an asset the plan lacks, or a script on an image", () => {
    expect(changeTexts(media("dog", "description", "A dog"), base)).toBeNull();
    expect(changeTexts(media("cat", "script", "Meow"), base)).toBeNull();
    expect(changeTexts(media("cat", "description", "x"), { ...base, manifest: null })).toBeNull();
  });

  it("knows a change the draft already holds", () => {
    expect(changeIsApplied({ target: "description", text: "Teach words" }, base)).toBe(true);
    expect(changeIsApplied({ target: "description", text: "Other" }, base)).toBe(false);
    expect(changeIsApplied(media("dog", "description", "x"), base)).toBe(false);
  });

  it("replaces one asset's text and leaves the rest of the plan alone", () => {
    const next = applyMediaChange(manifest, media("hello", "script", "Hello!"));
    expect(next.assets["en-US"]![1]).toMatchObject({
      key: "hello",
      script: "Hello!",
      description: "Greeting",
    });
    expect(next.assets["en-US"]![0]).toBe(manifest.assets["en-US"]![0]);
    expect(next.productCode).toBe("p");
    expect(manifest.assets["en-US"]![1]!.script).toBe("Hi");
    expect(() => applyMediaChange(manifest, media("dog", "description", "x"))).toThrow(/dog/);
  });

  it("names and keys changes", () => {
    expect(changeLabel({ target: "description", text: "" })).toBe("Activity Script");
    expect(changeLabel(media("hello", "script", ""))).toBe("hello script (en-US)");
    expect(changeKey(media("hello", "script", ""))).toBe("media:en-US:hello");
  });

  it("sums a change up: lines and the scenes they fall in, or a spec's fields", () => {
    const script = "Scene 1: Intro\nHello.\n\nScene 2: Rocks\nFind d.\n";
    const scriptBase = { ...base, description: script };
    expect(
      changeSummary(
        { target: "description", text: script.replace("Find d.", "Find lowercase d.") },
        scriptBase,
      ),
    ).toEqual({ text: "2 lines changed", scenes: [2] });
    expect(
      changeSummary({ target: "spec", spec: { id: "words", title: "Word play", age: 5 } }, base),
    ).toEqual({ text: "2 fields changed", scenes: [] });
    expect(changeSummary(media("hello", "script", "Hi there"), base)).toEqual({
      text: "2 lines changed",
      scenes: [],
    });
    expect(changeSummary(media("lost", "script", "x"), base)).toBeNull();
  });
});
