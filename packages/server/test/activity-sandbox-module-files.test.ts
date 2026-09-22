import { describe, expect, it } from "vitest";
import {
  moduleContentType,
  moduleFileHeaders,
  moduleFilePath,
} from "../src/activities/sandbox-module-files.js";

describe("what a preview may fetch from a build workspace", () => {
  it("serves the built output and the files a definition names", () => {
    expect(moduleFilePath("entry.js")).toBe("entry.js");
    expect(moduleFilePath("res/style.css")).toBe("res/style.css");
    expect(moduleFilePath("layout.html")).toBe("layout.html");
    expect(moduleFilePath("dist/main.js.map")).toBe("dist/main.js.map");
  });

  it("refuses a path that climbs out", () => {
    expect(moduleFilePath("../definition.json")).toBeNull();
    expect(moduleFilePath("a/../../b.js")).toBeNull();
    expect(moduleFilePath("/absolute.js")).toBeNull();
  });

  it("closes the dependency and version-control directories", () => {
    // A preview has no business reading either, and node_modules is most of the workspace.
    expect(moduleFilePath("node_modules/left-pad/index.js")).toBeNull();
    expect(moduleFilePath(".git/config")).toBeNull();
    expect(moduleFilePath(".typescript-build/index.js")).toBeNull();
    expect(moduleFilePath("src/node_modules/x.js")).toBeNull();
  });

  it("refuses an extension nobody serves rather than sending it as bytes", () => {
    // A build workspace holds .log, .ts and .env files; none of them belong in a browser.
    expect(moduleFilePath("build.log")).toBeNull();
    expect(moduleFilePath("src/index.ts")).toBeNull();
    expect(moduleFilePath(".env")).toBeNull();
    expect(moduleFilePath("README")).toBeNull();
  });

  it("refuses a malformed escape, which is a probe rather than a path", () => {
    expect(moduleFilePath("%E0%A4%A.js")).toBeNull();
    expect(moduleFilePath("")).toBeNull();
  });

  it("decodes an ordinary escape", () => {
    expect(moduleFilePath("res/my%20style.css")).toBe("res/my style.css");
  });
});

describe("how a module file is served", () => {
  it("names the type rather than leaving a browser to sniff it", () => {
    expect(moduleContentType("entry.js")).toBe("text/javascript; charset=utf-8");
    expect(moduleContentType("style.css")).toBe("text/css; charset=utf-8");
    expect(moduleContentType("layout.html")).toBe("text/html; charset=utf-8");
    expect(moduleContentType("main.js.map")).toBe("application/json; charset=utf-8");
    expect(moduleContentType("logo.svg")).toBe("image/svg+xml");
  });

  it("falls back rather than crashing on an extension it does not know", () => {
    expect(moduleContentType("mystery.zzz")).toBe("application/octet-stream");
  });

  it("is never cached", () => {
    // A preview exists to show the build that is there now; a stable URL with a cache
    // header is how an author looks at yesterday's code without knowing it.
    expect(moduleFileHeaders("entry.js")).toEqual({
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
  });
});
