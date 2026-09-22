import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  sandboxMediaRoot,
  sandboxModuleRoot,
  sandboxStatus,
  withinRoot,
} from "../src/activities/sandbox-paths.js";

describe("where the sandbox reads", () => {
  it("serves media from the draft's own directory, not an assembly run's copy", () => {
    // This is what makes a newly saved asset appear without rebuilding anything.
    expect(sandboxMediaRoot({ draftWorkspace: "/data/p/a/drafts/d" })).toBe(
      path.join("/data/p/a/drafts/d", "media"),
    );
  });

  it("serves the module from the run workspace that built it", () => {
    expect(sandboxModuleRoot("/data/activity-runs/r1")).toBe(
      path.join("/data/activity-runs/r1", "module"),
    );
  });
});

describe("containment", () => {
  const root = path.resolve("/srv/media");

  it("resolves a plain nested file", () => {
    expect(withinRoot(root, "images/cat.png")).toBe(path.join(root, "images/cat.png"));
  });

  it("refuses a relative path that climbs out", () => {
    expect(withinRoot(root, "../secret")).toBeNull();
    expect(withinRoot(root, "images/../../secret")).toBeNull();
  });

  it("refuses the root itself, which is a directory and not a file to serve", () => {
    expect(withinRoot(root, "")).toBeNull();
    expect(withinRoot(root, ".")).toBeNull();
  });

  it("refuses an absolute path, which would ignore the root entirely", () => {
    expect(withinRoot(root, path.resolve("/etc/passwd"))).toBeNull();
  });

  it("is not fooled by a sibling root whose name shares the prefix", () => {
    // `/srv/media-private` must not read as inside `/srv/media`.
    expect(withinRoot(root, path.join("..", "media-private", "x"))).toBeNull();
  });

  it("allows a path that climbs and comes back", () => {
    // `images/../audio/a.mp3` lands inside, so there is nothing to refuse.
    expect(withinRoot(root, "images/../audio/a.mp3")).toBe(path.join(root, "audio/a.mp3"));
  });
});

describe("what the client is told about a preview", () => {
  it("is ready, and says so shortly", () => {
    expect(sandboxStatus("ready", null)).toEqual({
      state: "ready",
      playable: true,
      buildable: false,
      message: "Ready.",
      buildLog: null,
    });
  });

  it("asks for a specification before anything else", () => {
    const status = sandboxStatus("pending_spec", null);
    expect(status.playable).toBe(false);
    expect(status.buildable).toBe(false);
    expect(status.message).toContain("Save a specification first");
  });

  it("points a non-canonical ref at the ref that owns the module", () => {
    const status = sandboxStatus("missing_shared_module", null);
    expect(status.buildable).toBe(false);
    expect(status.message).toContain("owns the module code");
  });

  it("says a stale module will rebuild rather than refusing to play it", () => {
    const status = sandboxStatus("stale", null);
    expect(status.playable).toBe(true);
    expect(status.buildable).toBe(true);
    expect(status.message).toContain("rebuild");
  });

  it("carries a failed build's output even when old output is still on disk", () => {
    // Reporting `ready` because a stale build happens to exist is the quiet success this
    // port is not allowed to produce.
    const status = sandboxStatus("stale", "ERROR in ./src/index.ts");
    expect(status.buildLog).toBe("ERROR in ./src/index.ts");
    expect(status.state).toBe("stale");
  });

  it("gives every state a message, so none can reach the UI unexplained", () => {
    for (const state of [
      "pending_spec",
      "pending_scaffold",
      "missing_shared_module",
      "stale",
      "ready",
    ] as const)
      expect(sandboxStatus(state, null).message.length, state).toBeGreaterThan(5);
  });
});
