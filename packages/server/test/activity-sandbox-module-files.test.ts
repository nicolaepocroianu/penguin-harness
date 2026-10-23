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

  it("serves the assets a module packages itself", () => {
    for (const file of [
      "engine/rive.wasm",
      "counting.riv",
      "models/apple.gltf",
      "models/apple.glb",
      "models/apple.bin",
      "audio/tap.mp3",
      "audio/tap.ogg",
      "audio/tap.wav",
    ])
      expect(moduleFilePath(file)).toBe(file);
    expect(moduleFilePath("../media/tap.mp3")).toBeNull();
    expect(moduleFilePath("node_modules/@rive-app/canvas/rive.wasm")).toBeNull();
  });

  it("refuses a path that climbs out", () => {
    expect(moduleFilePath("../definition.json")).toBeNull();
    expect(moduleFilePath("a/../../b.js")).toBeNull();
    expect(moduleFilePath("/absolute.js")).toBeNull();
  });

  it("closes the dependency, version-control and npm cache directories", () => {
    // A preview has no business reading any, and node_modules is most of the workspace.
    expect(moduleFilePath("node_modules/left-pad/index.js")).toBeNull();
    expect(moduleFilePath(".git/config")).toBeNull();
    expect(moduleFilePath(".typescript-build/index.js")).toBeNull();
    expect(moduleFilePath("src/node_modules/x.js")).toBeNull();
    // Where a confined build of a run's module keeps npm's cache.
    expect(moduleFilePath(".npm-cache/_cacache/index-v5/00/entry.json")).toBeNull();
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

  it("names the types of the assets a module packages itself", () => {
    // Streaming wasm compilation refuses anything but application/wasm.
    expect(moduleContentType("res/engine/rive.wasm")).toBe("application/wasm");
    expect(moduleContentType("counting.riv")).toBe("application/octet-stream");
    expect(moduleContentType("models/apple.gltf")).toBe("model/gltf+json");
    expect(moduleContentType("models/apple.glb")).toBe("model/gltf-binary");
    expect(moduleContentType("models/apple.bin")).toBe("application/octet-stream");
    expect(moduleContentType("models/apple.webp")).toBe("image/webp");
    expect(moduleContentType("audio/tap.mp3")).toBe("audio/mpeg");
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
