import path from "node:path";
import { describe, expect, it } from "vitest";
import { protectedPathIn } from "../src/path-guard.js";

const root = path.resolve("/checkouts/waf");
const workspace = path.resolve("/runs/run-1");
const inRoot = path.join(root, "framework", "index.ts");

describe("protectedPathIn", () => {
  it("finds a protected path among a tool call's reported locations", () => {
    expect(protectedPathIn({ locations: [{ path: inRoot }] }, [root], workspace)).toBe(inRoot);
  });

  it("finds one in the raw input under a path-like key, however deeply nested", () => {
    expect(
      protectedPathIn({ rawInput: { edits: [{ file_path: inRoot }] } }, [root], workspace),
    ).toBe(inRoot);
    expect(protectedPathIn({ rawInput: { paths: ["a.txt", inRoot] } }, [root], workspace)).toBe(
      inRoot,
    );
  });

  it("resolves a relative path against the workspace, so ../ cannot climb out unseen", () => {
    const workspaceInRoot = path.join(root, "modules");
    expect(
      protectedPathIn({ locations: [{ path: "../framework/x.ts" }] }, [root], workspaceInRoot),
    ).toBe(path.join(root, "framework", "x.ts"));
  });

  it("allows paths outside every root, and the root's lookalike siblings", () => {
    expect(
      protectedPathIn(
        { locations: [{ path: path.join(workspace, "spec.json") }] },
        [root],
        workspace,
      ),
    ).toBeNull();
    expect(protectedPathIn({ locations: [{ path: `${root}-copy/x` }] }, [root], workspace)).toBe(
      null,
    );
  });

  it("ignores strings that are not under a path-like key, such as a command's text", () => {
    expect(protectedPathIn({ rawInput: { command: `rm -rf ${root}` } }, [root], workspace)).toBe(
      null,
    );
  });

  it("matches without regard to case on Windows, where the filesystem ignores it", () => {
    const shouted = inRoot.toUpperCase();
    expect(protectedPathIn({ locations: [{ path: shouted }] }, [root], workspace)).toBe(
      process.platform === "win32" ? shouted : null,
    );
  });
});
