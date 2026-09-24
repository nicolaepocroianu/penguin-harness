import { describe, expect, it } from "vitest";
import type { BuiltinAgentInfo } from "@prismshadow/penguin-server/api";
import { builtinActions, progressPercent } from "../src/features/models/builtin-model";

const base: BuiltinAgentInfo = {
  id: "copilot",
  agentId: "copilot-builtin",
  title: "GitHub Copilot (built-in)",
  status: "not-installed",
  installedVersion: null,
  pinnedVersion: "1.0.88",
  downloadSize: null,
  progress: null,
  tokenMasked: null,
  message: null,
};

describe("built-in card actions", () => {
  it("offers setup with a token field when not set up", () => {
    expect(builtinActions(base)).toMatchObject({
      setup: true,
      needsToken: true,
      test: false,
      remove: false,
    });
  });
  it("offers only cancel while downloading", () => {
    const a = builtinActions({
      ...base,
      status: "downloading",
      progress: { received: 5, total: 10 },
    });
    expect(a).toEqual({
      setup: false,
      cancel: true,
      test: false,
      replaceToken: false,
      update: false,
      remove: false,
      retry: false,
      needsToken: false,
    });
  });
  it("offers test, replace token and remove when ready, plus update when a new version is pinned", () => {
    const ready = {
      ...base,
      status: "ready" as const,
      installedVersion: "1.0.88",
      tokenMasked: "gith…abcd",
    };
    expect(builtinActions(ready)).toMatchObject({
      test: true,
      replaceToken: true,
      remove: true,
      update: false,
    });
    expect(
      builtinActions({ ...ready, status: "update-available", installedVersion: "1.0.80" }),
    ).toMatchObject({ update: true, test: true });
  });
  it("offers retry after a failure, asking for a token only when none is stored", () => {
    expect(builtinActions({ ...base, status: "failed", message: "x" })).toMatchObject({
      retry: true,
      needsToken: true,
    });
    expect(
      builtinActions({
        ...base,
        status: "failed",
        message: "x",
        installedVersion: "1.0.80",
        tokenMasked: "gith…abcd",
      }),
    ).toMatchObject({ retry: true, needsToken: false, test: true });
  });
  it("offers nothing on an unsupported machine", () => {
    expect(Object.values(builtinActions({ ...base, status: "unsupported" })).some(Boolean)).toBe(
      false,
    );
  });
  it("turns progress into a percentage when the size is known", () => {
    expect(
      progressPercent({ ...base, status: "downloading", progress: { received: 25, total: 100 } }),
    ).toBe(25);
    expect(
      progressPercent({ ...base, status: "downloading", progress: { received: 25, total: null } }),
    ).toBeNull();
  });
});
