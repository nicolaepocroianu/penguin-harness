/**
 * The guard between a check and the evaluator's browser, call by call: what the harness and a
 * test's page work need passes; every other kind of object, a navigation off the played
 * module's origin, a context around the lock, files from or to this disk, raw DevTools, the
 * browser's own HTTP client, tracing and artifacts do not. Its real-browser proof is in
 * activity-bench-harness.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  LOCKDOWN_ARGS,
  isPlayOrigin,
  lockdownArgs,
  vetCall,
} from "../../../scripts/activity-bench/browser-guard.js";

const PLAY = "http://127.0.0.1:5000/preview/token/play";
const call = (guid: string, method: string, params?: Record<string, unknown>) =>
  vetCall({ guid, method, params }, PLAY);

describe("the browser guard", () => {
  it("passes what the harness and a test's page work do", () => {
    expect(call("", "initialize", { sdkLanguage: "javascript" })).toBeNull();
    expect(call("browser@1", "newContext", { viewport: { width: 1280, height: 800 } })).toBeNull();
    expect(call("browser-context@1", "newPage")).toBeNull();
    expect(call("frame@1", "goto", { url: PLAY })).toBeNull();
    expect(call("frame@1", "goto", { url: "http://localhost:5000/other" })).toBeNull();
    expect(call("frame@1", "goto", { url: "http://[::1]:5000/" })).toBeNull();
    expect(call("frame@1", "waitForFunction", { expression: "true" })).toBeNull();
    expect(call("page@1", "mouseClick", { x: 1, y: 2 })).toBeNull();
    expect(call("handle@1", "boundingBox")).toBeNull();
    expect(call("handle@1", "setInputFiles", { payloads: [] })).toBeNull();
    expect(call("route@1", "continue", {})).toBeNull();
    expect(call("request@1", "rawRequestHeaders")).toBeNull();
    expect(call("response@1", "body")).toBeNull();
    expect(call("dialog@1", "accept")).toBeNull();
    expect(call("bindingCall@1", "resolve", {})).toBeNull();
    expect(call("worker@1", "evaluateExpression", {})).toBeNull();
    expect(call("request-context@1", "dispose", {})).toBeNull();
    expect(call("browser-context@1", "close", {})).toBeNull();
  });

  it("refuses every kind of object it does not know", () => {
    for (const guid of [
      "something-new@1",
      "writable-stream@1",
      "stream@1",
      "artifact@1",
      "tracing@1",
      "cdp-session@1",
      "browser-type@chromium",
      "local-utils@1",
      "debug-controller@1",
      "json-pipe@1",
    ])
      expect(call(guid, "anything", {}), guid).toBe(
        `A check may not use ${guid.split("@")[0]!.toLowerCase()}.anything.`,
      );
    expect(call("writable-stream@1", "write", { binary: "AAAA" })).not.toBeNull();
  });

  it("refuses a navigation anywhere but the played module's origin", () => {
    for (const url of [
      "file:///C:/Users/someone/.claude/.credentials.json",
      "file:///home/someone/.waf-harness/data/web.db",
      "data:text/html,<p>",
      "chrome://settings",
      "view-source:file:///etc/passwd",
      "http://example.com/",
      "http://10.0.0.2:8080/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[fe80::1]/",
      "http://127.0.0.1:7368/api/projects",
      "http://localhost:5001/",
      "http://127.0.0.1/",
      "http://127.0.0.1.example.com:5000/",
      "http://localhost.example.com:5000/",
    ])
      expect(call("frame@1", "goto", { url }), url).toBe(
        `A check may open only the played module, not ${url}.`,
      );
    expect(call("route@1", "continue", { url: "http://127.0.0.1:7368/" })).toBe(
      "A check may not send a request anywhere but the played module.",
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

  it("refuses files the browser would read from or write to this disk", () => {
    for (const params of [{ localPaths: ["C:/secret.txt"] }, { localDirectory: "C:/Users" }]) {
      expect(call("frame@1", "setInputFiles", params)).toBe(
        "A check may not hand the page files from this disk.",
      );
      expect(call("handle@1", "setInputFiles", params)).toBe(
        "A check may not hand the page files from this disk.",
      );
    }
    expect(call("browser-context@1", "createTempFiles", { items: [] })).toBe(
      "A check may not use browser-context.createTempFiles.",
    );
  });

  it("refuses raw DevTools, the browser's own HTTP client, tracing and artifacts", () => {
    expect(call("browser-context@1", "newCDPSession", {})).toBe(
      "A check may not use browser-context.newCDPSession.",
    );
    expect(call("browser@1", "newBrowserCDPSession", {})).not.toBeNull();
    expect(call("Playwright", "newRequest", {})).not.toBeNull();
    expect(call("request-context@1", "fetch", { url: PLAY })).toBe(
      "A check may not make requests outside the browser (fetch).",
    );
    expect(call("browser@1", "startTracing", {})).not.toBeNull();
    expect(call("browser-context@1", "harStart", {})).not.toBeNull();
  });

  it("knows the played module's origin from what only looks like it", () => {
    expect(isPlayOrigin("http://127.0.0.1:5000/x", PLAY)).toBe(true);
    expect(isPlayOrigin("http://[::1]:5000/", PLAY)).toBe(true);
    expect(isPlayOrigin("https://127.0.0.1:5000/", PLAY)).toBe(true);
    expect(isPlayOrigin("http://127.0.0.1:5001/", PLAY)).toBe(false);
    expect(isPlayOrigin("http://127.0.0.2:5000/", PLAY)).toBe(false);
    expect(isPlayOrigin("ws://127.0.0.1:5000/", PLAY)).toBe(false);
    expect(isPlayOrigin("http://127.0.0.1/", "http://127.0.0.1/play")).toBe(true);
    expect(isPlayOrigin("not a url", PLAY)).toBe(false);
    expect(isPlayOrigin(undefined, PLAY)).toBe(false);
  });

  it("starts the browser with only the played module's port off the dead proxy", () => {
    expect(LOCKDOWN_ARGS).toEqual(
      expect.arrayContaining([
        "--proxy-server=http://127.0.0.1:9",
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      ]),
    );
    expect(lockdownArgs(PLAY)).toEqual([
      ...LOCKDOWN_ARGS,
      "--proxy-bypass-list=<-loopback>;127.0.0.1:5000;localhost:5000;[::1]:5000",
    ]);
  });
});
