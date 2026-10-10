/**
 * Scene looks. What this proves: the installed waf-authoring plugin ships the looks, each named,
 * described, with its guidance and its tokens as CSS variables; an unknown look is none; and a
 * composition made in a look may link its stylesheet and is told which look it is in.
 */
import { describe, expect, it } from "vitest";
import { compositionInput, stagedFiles } from "../src/activities/composition.js";
import { COMPOSITION_LOOK_FILE, sceneLook, sceneLooks } from "../src/activities/scene-looks.js";

describe("scene looks", () => {
  it("ships each look with its name, description, guidance and tokens", () => {
    expect(sceneLooks().map((look) => look.id)).toEqual(["bright-flat", "chalkboard", "storybook"]);
    for (const look of sceneLooks()) {
      expect(look.name).toBeTruthy();
      expect(look.description).toBeTruthy();
      const files = sceneLook(look.id)!;
      expect(files.design).toContain(`# ${look.name}`);
      expect(files.css).toMatch(/:root\s*\{[^}]*--look-font:/);
    }
    expect(sceneLook("no-such-look")).toBeNull();
  });

  it("lets a composition in a look link its stylesheet, and says which look", () => {
    const target = {
      language: "en-US",
      assetKey: "v",
      sceneId: "s",
      width: 640,
      height: 480,
      images: [],
    };
    expect(stagedFiles(target).has(COMPOSITION_LOOK_FILE)).toBe(false);
    expect(stagedFiles({ ...target, look: "storybook" }).has(COMPOSITION_LOOK_FILE)).toBe(true);
    const scene = { sceneId: "s", description: "", assetDescription: "" } as unknown as Parameters<
      typeof compositionInput
    >[0];
    expect(compositionInput(scene, { ...target, look: "storybook" }).look).toBe("storybook");
    expect(compositionInput(scene, target)).not.toHaveProperty("look");
  });
});
