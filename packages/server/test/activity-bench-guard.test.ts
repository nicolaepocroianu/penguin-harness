/**
 * The guard between a check and the evaluator's browser, call by call: what the harness needs
 * passes; a navigation off loopback, a context around the lock, files from this disk, raw
 * DevTools, the browser's own HTTP client, tracing, artifacts and launching browsers do not.
 * Its real-browser proof is in activity-bench-harness.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  LOCKDOWN_ARGS,
  isLoopbackHttp,
  vetCall,
} from "../../../scripts/activity-bench/browser-guard.js";

const call = (guid: string, method: string, params?: Record<string, unknown>) =>
  vetCall({ guid, method, params });

describe("the browser guard", () => {
  it("passes what the harness does", () => {
    expect(call("", "initialize", { sdkLanguage: "javascript" })).toBeNull();
    expect(call("browser@1", "newContext", { viewport: { width: 1280, height: 800 } })).toBeNull();
    expect(call("browser-context@1", "newPage")).toBeNull();
    expect(call("frame@1", "goto", { url: "http://127.0.0.1:5000/preview/x/play" })).toBeNull();
    expect(call("frame@1", "goto", { url: "https://localhost:8443/" })).toBeNull();
    expect(call("frame@1", "goto", { url: "http://[::1]:5000/" })).toBeNull();
    expect(call("frame@1", "waitForFunction", { expression: "true" })).toBeNull();
    expect(call("page@1", "mouseClick", { x: 1, y: 2 })).toBeNull();
    expect(call("handle@1", "setInputFiles", { payloads: [] })).toBeNull();
    expect(call("route@1", "continue", {})).toBeNull();
    expect(call("request-context@1", "dispose", {})).toBeNull();
    expect(call("browser-context@1", "close", {})).toBeNull();
  });

  it("refuses a navigation to anything but http(s) on loopback", () => {
    for (const url of [
      "file:///C:/Users/someone/.claude/.credentials.json",
      "file:///home/someone/.penguin/data/web.db",
      "data:text/html,<p>",
      "chrome://settings",
      "view-source:file:///etc/passwd",
      "http://example.com/",
      "http://10.0.0.2:8080/",
      "http://127.0.0.1.example.com/",
      "http://localhost.example.com/",
    ])
      expect(call("frame@1", "goto", { url }), url).toBe(
        `A check may open only the played module, not ${url}.`,
      );
    expect(call("route@1", "continue", { url: "http://example.com/" })).toBe(
      "A check may not send a request anywhere but loopback.",
    );
  });

  it("refuses a context around the lock, or one that writes files", () => {
    for (const option of ["proxy", "recordVideo", "recordHar"])
      expect(call("browser@1", "newContext", { [option]: {} })).toBe(
        `A check may not set a context's ${option}.`,
      );
    expect(call("browser@1", "newContextForReuse", {})).toBe(
      "A check may not use browser.newContextForReuse.",
    );
  });

  it("refuses files the browser would read from this disk", () => {
    for (const params of [{ localPaths: ["C:/secret.txt"] }, { localDirectory: "C:/Users" }]) {
      expect(call("frame@1", "setInputFiles", params)).toBe(
        "A check may not hand the page files from this disk.",
      );
      expect(call("handle@1", "setInputFiles", params)).toBe(
        "A check may not hand the page files from this disk.",
      );
    }
  });

  it("refuses raw DevTools, the browser's own HTTP client, tracing, artifacts and launches", () => {
    expect(call("browser-context@1", "newCDPSession", {})).toBe(
      "A check may not use browser-context.newCDPSession.",
    );
    expect(call("browser@1", "newBrowserCDPSession", {})).not.toBeNull();
    expect(call("cdp-session@1", "send", { method: "Page.navigate" })).not.toBeNull();
    expect(call("Playwright", "newRequest", {})).not.toBeNull();
    expect(call("request-context@1", "fetch", { url: "http://example.com/" })).toBe(
      "A check may not make requests outside the browser (fetch).",
    );
    expect(call("browser@1", "startTracing", {})).not.toBeNull();
    expect(call("tracing@1", "tracingStart", {})).not.toBeNull();
    expect(call("artifact@1", "saveAs", { path: "C:/anywhere" })).not.toBeNull();
    expect(call("browser-context@1", "harStart", {})).not.toBeNull();
    expect(call("browser-type@chromium", "launch", {})).not.toBeNull();
    expect(call("local-utils@1", "zip", {})).not.toBeNull();
  });

  it("knows loopback from what only looks like it", () => {
    expect(isLoopbackHttp("http://127.0.0.1:1/")).toBe(true);
    expect(isLoopbackHttp("https://[::1]:8443/x")).toBe(true);
    expect(isLoopbackHttp("http://127.0.0.2/")).toBe(false);
    expect(isLoopbackHttp("ws://127.0.0.1/")).toBe(false);
    expect(isLoopbackHttp("not a url")).toBe(false);
    expect(isLoopbackHttp(undefined)).toBe(false);
  });

  it("starts the browser with no way off loopback", () => {
    expect(LOCKDOWN_ARGS).toEqual(
      expect.arrayContaining([
        "--proxy-server=http://127.0.0.1:9",
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      ]),
    );
  });
});
