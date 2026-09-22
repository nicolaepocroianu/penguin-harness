import { describe, expect, it } from "vitest";
import {
  ifRangeMatches,
  moduleStale,
  parseByteRange,
  previewMediaPath,
  previewNeedsBuild,
  previewPlayable,
  previewState,
  type PreviewInputs,
} from "../src/activities/sandbox-model.js";

const ready: PreviewInputs = {
  hasSpec: true,
  hasModule: true,
  canonicalRef: true,
  builtAtMs: 2_000,
  sourceMtimesMs: [1_000, 1_500],
};

describe("build freshness", () => {
  it("treats a module that was never built as stale", () => {
    expect(moduleStale(null, [])).toBe(true);
  });

  it("is current when every source predates the build", () => {
    expect(moduleStale(2_000, [1_000, 1_999])).toBe(false);
  });

  it("is stale when any source is newer", () => {
    expect(moduleStale(2_000, [1_000, 2_001])).toBe(true);
  });

  it("rebuilds on a tie, because a source written in the same millisecond may be unseen", () => {
    expect(moduleStale(2_000, [2_000])).toBe(true);
  });

  it("is current when there are no sources to compare", () => {
    expect(moduleStale(2_000, [])).toBe(false);
  });
});

describe("what state a preview is in", () => {
  it("is ready when built and current", () => {
    expect(previewState(ready)).toBe("ready");
  });

  it("waits for a specification first, since there are no scenes without one", () => {
    expect(previewState({ ...ready, hasSpec: false })).toBe("pending_spec");
  });

  it("names the shared module before the scaffold, so nobody is sent to a refused button", () => {
    // A non-canonical ref cannot build, so reporting a missing scaffold would point an
    // author at an action that must refuse them.
    expect(previewState({ ...ready, canonicalRef: false, hasModule: false })).toBe(
      "missing_shared_module",
    );
  });

  it("asks for a scaffold when the ref owns the module and has none", () => {
    expect(previewState({ ...ready, hasModule: false })).toBe("pending_scaffold");
  });

  it("is stale when a source moved after the build", () => {
    expect(previewState({ ...ready, sourceMtimesMs: [3_000] })).toBe("stale");
  });

  it("plays a stale module rather than refusing, and says it is stale", () => {
    expect(previewPlayable("stale")).toBe(true);
    expect(previewPlayable("ready")).toBe(true);
    expect(previewPlayable("pending_spec")).toBe(false);
    expect(previewPlayable("pending_scaffold")).toBe(false);
    expect(previewPlayable("missing_shared_module")).toBe(false);
  });

  it("builds on demand for exactly the two states a build can fix", () => {
    expect(previewNeedsBuild("stale")).toBe(true);
    expect(previewNeedsBuild("pending_scaffold")).toBe(true);
    expect(previewNeedsBuild("ready")).toBe(false);
    expect(previewNeedsBuild("pending_spec")).toBe(false);
    expect(previewNeedsBuild("missing_shared_module")).toBe(false);
  });
});

describe("byte ranges, for video seeking", () => {
  it("sends the whole file when there is no range", () => {
    expect(parseByteRange(null, 100)).toBeNull();
    expect(parseByteRange("", 100)).toBeNull();
    expect(parseByteRange("bytes=-", 100)).toBeNull();
  });

  it("reads a closed range", () => {
    expect(parseByteRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9, length: 10 });
    expect(parseByteRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19, length: 10 });
  });

  it("runs an open-ended range to the end of the file", () => {
    expect(parseByteRange("bytes=90-", 100)).toEqual({ start: 90, end: 99, length: 10 });
  });

  it("reads a suffix range as the LAST bytes, not the first", () => {
    expect(parseByteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99, length: 10 });
  });

  it("clamps a suffix longer than the file to the whole file", () => {
    expect(parseByteRange("bytes=-500", 100)).toEqual({ start: 0, end: 99, length: 100 });
  });

  it("clamps an end past the file rather than refusing what does exist", () => {
    expect(parseByteRange("bytes=50-500", 100)).toEqual({ start: 50, end: 99, length: 50 });
  });

  it("refuses a start past the end of the file", () => {
    // 416, not a silent 200: a player given the whole file for a range it cannot use
    // seeks forever.
    expect(parseByteRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=200-300", 100)).toBe("unsatisfiable");
  });

  it("refuses a reversed range and a zero-length suffix", () => {
    expect(parseByteRange("bytes=50-20", 100)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=-0", 100)).toBe("unsatisfiable");
  });

  it("refuses any range against an empty file", () => {
    expect(parseByteRange("bytes=0-0", 0)).toBe("unsatisfiable");
  });

  it("ignores a unit it does not serve, and a multipart range", () => {
    expect(parseByteRange("items=0-9", 100)).toBeNull();
    expect(parseByteRange("bytes=0-9,20-29", 100)).toBeNull();
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseByteRange("  bytes=0-9  ", 100)).toEqual({ start: 0, end: 9, length: 10 });
  });
});

describe("If-Range", () => {
  it("serves a partial response while the validator still matches", () => {
    expect(ifRangeMatches('"abc"', '"abc"')).toBe(true);
  });

  it("falls back to the whole file when the file changed underneath", () => {
    // Otherwise a video plays two halves of two different takes.
    expect(ifRangeMatches('"abc"', '"def"')).toBe(false);
  });

  it("treats an absent validator as a match", () => {
    expect(ifRangeMatches(null, '"abc"')).toBe(true);
  });
});

describe("the media path a preview may ask for", () => {
  it("accepts a plain nested path", () => {
    expect(previewMediaPath("images/en-US/cat.png")).toBe("images/en-US/cat.png");
  });

  it("decodes escapes", () => {
    expect(previewMediaPath("audio/en-US/hello%20world.mp3")).toBe("audio/en-US/hello world.mp3");
  });

  it("normalises separators, collapsing a doubled one", () => {
    expect(previewMediaPath("images\\en-US\\cat.png")).toBe("images/en-US/cat.png");
    // Collapsed rather than refused: a doubled slash is sloppy, not hostile, and the
    // traversal segments it might hide are still caught below.
    expect(previewMediaPath("images//cat.png")).toBe("images/cat.png");
  });

  it("refuses anything that climbs out", () => {
    for (const bad of ["../secret", "images/../../secret", "./images/cat.png", ".."])
      expect(previewMediaPath(bad), bad).toBeNull();
  });

  it("refuses a malformed escape rather than guessing", () => {
    expect(previewMediaPath("%ZZ")).toBeNull();
  });

  it("refuses a null byte and the characters Windows will not open", () => {
    expect(previewMediaPath("cat%00.png")).toBeNull();
    for (const bad of ["c:at.png", "ca?t.png", 'ca"t.png', "cat.png.", "cat "])
      expect(previewMediaPath(bad), bad).toBeNull();
  });

  it("refuses an empty path", () => {
    expect(previewMediaPath("")).toBeNull();
  });
});
