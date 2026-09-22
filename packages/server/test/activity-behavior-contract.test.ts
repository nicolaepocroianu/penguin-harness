import { describe, expect, it } from "vitest";
import {
  checkBehaviorContract,
  machineLayout,
  requiredPaths,
  reviewWorthStarting,
} from "../src/activities/behavior-contract.js";

const nested = [
  "package.json",
  "definition.json",
  "src/index.ts",
  "src/activity/index.ts",
  "src/activity/events.ts",
  "src/runtime/assets.ts",
  "src/runtime/media.ts",
  "res/layout.html",
  "res/style.scss",
];

const flat = [
  "package.json",
  "definition.json",
  "src/index.ts",
  "src/activity.ts",
  "res/layout.html",
  "res/style.scss",
];

const sequence = [
  "package.json",
  "definition.json",
  "src/index.js",
  "src/activity-state.js",
  "src/preview-start.js",
  "src/sequence.js",
  "res/layout.html",
  "res/style.scss",
];

describe("which machine layout is in use", () => {
  it("is nested when the activity directory is there", () => {
    expect(machineLayout(nested)).toBe("nested");
  });

  it("is flat otherwise, rather than rejecting a single-file implementation", () => {
    // Deciding for the agent would mean rejecting a flat implementation that works.
    expect(machineLayout(flat)).toBe("flat");
    expect(machineLayout([])).toBe("flat");
  });
});

describe("what a run must produce", () => {
  it("asks the sequence path for its own files", () => {
    expect(requiredPaths("sequence", sequence)).toContain("src/sequence.js");
    expect(requiredPaths("sequence", sequence)).not.toContain("src/index.ts");
  });

  it("asks a nested machine for the runtime and events modules", () => {
    const required = requiredPaths("machine", nested);
    expect(required).toContain("src/activity/events.ts");
    expect(required).toContain("src/runtime/media.ts");
  });

  it("asks a flat machine for only its single activity file", () => {
    const required = requiredPaths("machine", flat);
    expect(required).toContain("src/activity.ts");
    expect(required).not.toContain("src/activity/events.ts");
  });

  it("asks both machine layouts and the sequence path for the shared files", () => {
    for (const [path, present] of [
      ["machine", nested],
      ["machine", flat],
      ["sequence", sequence],
    ] as const)
      for (const shared of ["package.json", "definition.json", "res/layout.html", "res/style.scss"])
        expect(requiredPaths(path, present), shared).toContain(shared);
  });
});

describe("checking an implementation", () => {
  it("passes a complete nested machine and says which contract it met", () => {
    const result = checkBehaviorContract("machine", nested);
    expect(result).toMatchObject({ ok: true, layout: "nested", missing: [] });
    expect(result.message).toContain("nested state-machine contract");
  });

  it("passes a complete flat machine", () => {
    expect(checkBehaviorContract("machine", flat)).toMatchObject({ ok: true, layout: "flat" });
  });

  it("passes a complete sequence implementation", () => {
    const result = checkBehaviorContract("sequence", sequence);
    expect(result).toMatchObject({ ok: true, layout: "sequence" });
    expect(result.message).toContain("sequence contract");
  });

  it("names every missing file, not the first", () => {
    // An agent told only the first fixes it, is re-reviewed, and is told the next --
    // turning one round trip into six paid agent passes.
    const result = checkBehaviorContract(
      "machine",
      nested.filter((file) => !file.startsWith("src/runtime/")),
    );
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["src/runtime/assets.ts", "src/runtime/media.ts"]);
    expect(result.message).toContain("src/runtime/assets.ts");
    expect(result.message).toContain("src/runtime/media.ts");
    expect(result.message).toContain("2 files");
  });

  it("uses the singular for one missing file", () => {
    const result = checkBehaviorContract(
      "sequence",
      sequence.filter((file) => file !== "src/sequence.js"),
    );
    expect(result.message).toContain("1 file");
  });

  it("judges an empty module against the flat layout and reports all of it", () => {
    const result = checkBehaviorContract("machine", []);
    expect(result.layout).toBe("flat");
    expect(result.missing).toHaveLength(6);
  });

  it("does not credit a sequence implementation for machine files", () => {
    const result = checkBehaviorContract("sequence", nested);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("src/sequence.js");
  });

  it("ignores files beyond the contract", () => {
    expect(checkBehaviorContract("machine", [...flat, "src/extra.ts"]).ok).toBe(true);
  });
});

describe("whether a review pass is worth starting", () => {
  it("runs the review on an implementation that met its contract", () => {
    expect(reviewWorthStarting(checkBehaviorContract("machine", nested))).toBe(true);
  });

  it("skips it when the contract was not met", () => {
    // A second agent pass would spend a paid run to be told what the contract check
    // already knows, about code that is about to be rewritten.
    expect(reviewWorthStarting(checkBehaviorContract("machine", []))).toBe(false);
  });
});
