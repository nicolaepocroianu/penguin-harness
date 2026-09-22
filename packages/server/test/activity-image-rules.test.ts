import { describe, expect, it } from "vitest";
import {
  describeImagePlan,
  imageDecision,
  isPlaceholderImage,
  planImages,
  type ImageAssetState,
} from "../src/activities/image-rules.js";

const drawn: ImageAssetState = {
  key: "cat",
  description: "A cat",
  path: "media/images/en-US/cat.svg",
  fileExists: true,
  generatedFrom: "A cat",
};

describe("spotting the seeded placeholder", () => {
  it("matches the stem, whatever the extension", () => {
    // assets_configuration seeds every image asset with a shared empty file.
    for (const path of ["media/images/empty.jpg", "media/images/empty.png", "empty.svg"])
      expect(isPlaceholderImage(path), path).toBe(true);
  });

  it("does not match real artwork whose name merely contains it", () => {
    for (const path of ["media/images/empty-nest.svg", "media/images/not-empty.svg"])
      expect(isPlaceholderImage(path), path).toBe(false);
  });

  it("handles a Windows separator", () => {
    expect(isPlaceholderImage("media\\images\\empty.jpg")).toBe(true);
  });
});

describe("what to do about one image", () => {
  it("draws an unbound asset", () => {
    expect(imageDecision({ ...drawn, path: undefined }).action).toBe("generate");
  });

  it("draws over the seeded placeholder", () => {
    // The rule that is easy to get backwards: treating the placeholder as generated art
    // makes the whole stage do nothing.
    const decision = imageDecision({ ...drawn, path: "media/images/empty.jpg" });
    expect(decision.action).toBe("generate");
    expect(decision.reason).toContain("placeholder");
  });

  it("draws when the bound SVG is not there", () => {
    expect(imageDecision({ ...drawn, fileExists: false }).action).toBe("generate");
  });

  it("draws when the description has changed since the artwork was drawn", () => {
    const decision = imageDecision({ ...drawn, description: "A dog" });
    expect(decision.action).toBe("generate");
    expect(decision.reason).toContain("description changed");
  });

  it("leaves artwork that already matches its description", () => {
    expect(imageDecision(drawn).action).toBe("skip");
  });

  it("leaves an uploaded file alone rather than drawing over it", () => {
    const decision = imageDecision({
      ...drawn,
      path: "media/images/en-US/photo.png",
      generatedFrom: undefined,
    });
    expect(decision.action).toBe("skip");
    expect(decision.reason).toContain("uploaded");
  });

  it("does not assume artwork with no recorded description is stale", () => {
    // Regenerating it would replace something an author may have accepted.
    const decision = imageDecision({ ...drawn, generatedFrom: undefined });
    expect(decision.action).toBe("skip");
    expect(decision.reason).toContain("records no description");
  });

  it("refuses a non-SVG target that is not there, and says what to do", () => {
    const decision = imageDecision({
      ...drawn,
      path: "media/images/en-US/photo.png",
      fileExists: false,
    });
    expect(decision.action).toBe("refuse");
    expect(decision.reason).toContain("not an SVG");
    expect(decision.reason).toContain("upload a file or clear the path");
  });

  it("treats an uppercase extension as an SVG", () => {
    expect(imageDecision({ ...drawn, path: "media/images/CAT.SVG" }).action).toBe("skip");
  });
});

describe("a plan over a manifest", () => {
  const assets: ImageAssetState[] = [
    { key: "unbound", description: "x", fileExists: false },
    { key: "placeholder", description: "x", path: "media/images/empty.jpg", fileExists: true },
    {
      key: "current",
      description: "A cat",
      path: "a.svg",
      fileExists: true,
      generatedFrom: "A cat",
    },
    { key: "stale", description: "A dog", path: "b.svg", fileExists: true, generatedFrom: "A cat" },
    { key: "uploaded", description: "x", path: "c.png", fileExists: true },
    { key: "broken", description: "x", path: "d.png", fileExists: false },
  ];

  it("sorts every asset into the right bucket", () => {
    const plan = planImages(assets);
    expect(plan.generate).toEqual(["unbound", "placeholder", "stale"]);
    expect(plan.skip).toEqual(["current", "uploaded"]);
    expect(plan.refuse.map((entry) => entry.key)).toEqual(["broken"]);
  });

  it("describes the plan with refusals named, not folded into the skips", () => {
    // A refusal needs an author to act; a skip does not. Reporting them together hides
    // the difference.
    const message = describeImagePlan(planImages(assets));
    expect(message).toContain("Drawing 3 images.");
    expect(message).toContain("2 already current.");
    expect(message).toContain("1 cannot be drawn: broken.");
  });

  it("says so plainly when there is nothing to draw", () => {
    expect(describeImagePlan(planImages([assets[2]!]))).toBe(
      "No artwork needs drawing. 1 already current.",
    );
  });

  it("uses the singular for one image", () => {
    expect(describeImagePlan(planImages([assets[0]!]))).toBe("Drawing 1 image.");
  });

  it("handles an empty manifest", () => {
    expect(describeImagePlan(planImages([]))).toBe("No artwork needs drawing.");
  });
});
