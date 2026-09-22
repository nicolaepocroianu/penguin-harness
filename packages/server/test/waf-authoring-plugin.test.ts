/**
 * The WAF authoring skills, ported from Loom's vendored templates.
 *
 * A generation stage reaches these two ways: as a one-line entry in an agent's system
 * prompt with an instruction to read the file, and — for a skill carrying scripts — by the
 * server pulling a file out by path and staging it into a run workspace. Both depend on the
 * plugin loading with the names the stages ask for, which is what this pins.
 */
import { describe, expect, it } from "vitest";
import { libraryPlugin, librarySkill } from "@prismshadow/penguin-core";

/** Every skill Loom vendors that the ported pipeline still needs. */
const EXPECTED = [
  "project-documentation",
  "waf-activity-identity",
  "waf-activity-states",
  "waf-assessment-patterns",
  "waf-asset-usage-patterns",
  "waf-audio-patterns",
  "waf-book-generation",
  "waf-element-ids",
  "waf-state-machine",
  "waf-style-guardrails",
  "waf-video-patterns",
  "xstate-v5",
];

describe("the waf-authoring plugin", () => {
  it("loads with its metadata", () => {
    const plugin = libraryPlugin("waf-authoring");
    expect(plugin).toBeTruthy();
    expect(plugin!.category).toBe("software-development");
    // WAF-specific, so a fresh Agent does not get it: the stages that need it read its
    // files directly, and nobody else should carry 250 KB of WAF contracts.
    expect(plugin!.preinstall).toBe(false);
  });

  it("ships every skill the ported stages name, and nothing else", () => {
    const names = libraryPlugin("waf-authoring")!
      .skills.map((skill) => skill.name)
      .sort();
    expect(names).toEqual([...EXPECTED].sort());
  });

  it("leaves behind what the port deliberately dropped", () => {
    const names = libraryPlugin("waf-authoring")!.skills.map((skill) => skill.name);
    // Loom's two sequence skills are marked legacy there -- they implement src/sequence.js,
    // which the state-machine path replaced.
    expect(names).not.toContain("waf-sequence-from-prose");
    expect(names).not.toContain("waf-sequence-implementation-patterns");
    // test_activity is out of scope, so its test-writing skill has no reader.
    expect(names).not.toContain("waf-playwright-test-writing");
  });

  it("gives every skill a description, since that line is all the model sees first", () => {
    for (const skill of libraryPlugin("waf-authoring")!.skills) {
      expect(skill.description, skill.name).toBeTruthy();
      expect(skill.description!.length, skill.name).toBeGreaterThan(20);
    }
  });

  it("carries each skill's body rather than just its name", () => {
    for (const name of EXPECTED) {
      const found = librarySkill(name);
      expect(found, name).toBeTruthy();
      expect(found!.plugin.name, name).toBe("waf-authoring");
      // The shortest of these is the activity-identity contract, about 1.9 KB in Loom.
      expect(found!.skill.content.length, name).toBeGreaterThan(500);
    }
  });

  it("keeps xstate-v5's reference files, which its own prose points at", () => {
    const paths = Object.keys(librarySkill("xstate-v5")!.skill.files ?? {});
    expect(paths.length).toBe(5);
    expect(paths.every((path) => path.startsWith("references/"))).toBe(true);
  });
});
