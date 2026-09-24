import { describe, expect, it } from "vitest";
import {
  COPILOT_VERSION,
  binaryFromManifest,
  copilotPackageName,
} from "../src/coding-agents/builtin/copilot-package.js";

describe("copilot package facts", () => {
  it("pins a version", () => expect(COPILOT_VERSION).toMatch(/^\d+\.\d+\.\d+$/));

  it("names the platform package, musl included, and nothing for unknown platforms", () => {
    expect(copilotPackageName("win32", "x64", false)).toBe("@github/copilot-win32-x64");
    expect(copilotPackageName("darwin", "arm64", false)).toBe("@github/copilot-darwin-arm64");
    expect(copilotPackageName("linux", "x64", false)).toBe("@github/copilot-linux-x64");
    expect(copilotPackageName("linux", "arm64", true)).toBe("@github/copilot-linuxmusl-arm64");
    expect(copilotPackageName("linux", "ia32", false)).toBeNull();
    expect(copilotPackageName("freebsd", "x64", false)).toBeNull();
  });

  it("reads the program from the manifest's exports, else its bin", () => {
    expect(binaryFromManifest({ exports: { ".": "./copilot.exe" } })).toBe("copilot.exe");
    expect(binaryFromManifest({ bin: { "copilot-linux-x64": "copilot" } })).toBe("copilot");
    expect(() => binaryFromManifest({})).toThrow(/program/);
  });
});
