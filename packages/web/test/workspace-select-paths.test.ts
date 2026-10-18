import { describe, expect, it } from "vitest";
import { baseName, isAbsoluteDirPath } from "../src/features/chat/workspace-finder-model";

describe("folder picker paths", () => {
  it("starts from a filled absolute path on either kind of server", () => {
    expect(isAbsoluteDirPath("/home/me/waf")).toBe(true);
    expect(isAbsoluteDirPath("C:\\Users\\me\\waf")).toBe(true);
    expect(isAbsoluteDirPath("c:/Users/me")).toBe(true);
    expect(isAbsoluteDirPath("\\\\server\\share")).toBe(true);
    expect(isAbsoluteDirPath("waf")).toBe(false);
    expect(isAbsoluteDirPath("")).toBe(false);
  });

  it("names a folder by its last segment", () => {
    expect(baseName("/home/me/waf")).toBe("waf");
    expect(baseName("C:\\Users\\me\\waf\\")).toBe("waf");
    expect(baseName("/")).toBe("/");
  });
});
