/**
 * The test browser locked down for checks the server runs itself (decision 17). The checks are
 * an earlier run's agent's code, and the browser runs unconfined, as this server's user: left
 * alone, a check could open `file:///…` and read anything that user can (WAF Harness's own data,
 * its Agents' Vaults), or send it to any host. Ported from the activity bench's evaluator
 * (scripts/activity-bench/browser-guard.ts), which locks its browser the same way.
 *
 * Two locks, neither of which a check can lift:
 *
 * - The network: Chromium starts with a proxy that leads nowhere for everything but the play
 *   link's own host and port; every other host name resolves to nothing; and WebRTC may not
 *   send UDP around the proxy. A page reaches the played activity's server and nothing else.
 * - The protocol: a check never meets the browser's own endpoint. It connects to a guard that
 *   passes on only calls on the kinds of object the harness and a check's page work use, and of
 *   those refuses a navigation anywhere but the play link's origin, a context with its own
 *   proxy or recordings, files the browser would read from or write to this disk, raw DevTools
 *   sessions, the browser's own HTTP client, tracing and artifacts. A refused call fails in the
 *   check like any error.
 *
 * Chromium itself refuses a page's own way to a local file (a link, a redirect, `window.open`).
 */
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";

/** Chromium switches that leave a page nothing to reach; `lockdownArgs` lets the play link through. */
const LOCKDOWN_ARGS = [
  // Everything goes to a port nothing answers on, but what the bypass list names.
  "--proxy-server=http://127.0.0.1:9",
  "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
  "--disable-background-networking",
  "--no-pings",
];

function portOf(url: URL): string {
  return url.port || (url.protocol === "https:" ? "443" : "80");
}

/** The switches for one run: the lock, with only the play link's host and port let through. */
export function lockdownArgs(playUrl: string): string[] {
  const url = new URL(playUrl);
  // `<-loopback>` ends Chromium's own bypass of loopback: any other port goes nowhere too.
  return [
    ...LOCKDOWN_ARGS,
    `--proxy-bypass-list=<-loopback>;${url.hostname}:${portOf(url)}`,
    `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE ${url.hostname.replace(/^\[|\]$/g, "")}`,
  ];
}

/**
 * The kinds of protocol object a check may call (a guid's prefix): what the harness and a
 * check's work on its pages use. Every other kind is refused — the browser's types, DevTools
 * sessions, tracing, artifacts, streams that write files, and whatever a later Playwright adds.
 */
const ALLOWED_TYPES = new Set([
  // The connection's root, and Playwright's own object.
  "",
  "playwright",
  "browser",
  "browser-context",
  "page",
  "frame",
  // Element and JS handles share one prefix; the longer names are kept in case one comes.
  "handle",
  "element-handle",
  "js-handle",
  "route",
  "request",
  "response",
  "worker",
  "dialog",
  "console-message",
  "bindingcall",
  "binding-call",
  "web-socket",
  // Only to dispose of a context's API client: its requests are refused below.
  "request-context",
]);

/** Methods, on any object, that reach past the page: raw DevTools, server-side HTTP and files. */
const REFUSED_METHODS = new Set([
  "createTempFiles",
  "newCDPSession",
  "newBrowserCDPSession",
  "newRequest",
  "newContextForReuse",
  "startTracing",
  "stopTracing",
  "harStart",
  "harExport",
  "enableRecorder",
  "saveAs",
  "saveAsStream",
]);

/** What `browser.newContext` may not set: a proxy around the lock, or files the browser writes. */
const REFUSED_CONTEXT_OPTIONS = ["proxy", "recordVideo", "recordHar"];

/** Whether a URL is the play link's origin: the same scheme, host and port. */
export function isPlayOrigin(value: unknown, playUrl: string): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    const play = new URL(playUrl);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.protocol === play.protocol &&
      url.hostname === play.hostname &&
      portOf(url) === portOf(play)
    );
  } catch {
    return false;
  }
}

/** Why the guard refuses one protocol call, or null when it passes it on. */
export function vetCall(
  message: { guid?: unknown; method?: unknown; params?: unknown },
  playUrl: string,
): string | null {
  const type = String(message.guid ?? "")
    .split("@")[0]!
    .toLowerCase();
  const method = String(message.method ?? "");
  const params = (message.params ?? {}) as Record<string, unknown>;
  if (!ALLOWED_TYPES.has(type) || REFUSED_METHODS.has(method))
    return `A check may not use ${type ? `${type}.` : ""}${method}.`;
  // A context's own API client makes requests from the server, not the browser.
  if (type === "request-context" && method !== "dispose" && method !== "disposeAPIResponse")
    return `A check may not make requests outside the browser (${method}).`;
  if (
    method === "setInputFiles" &&
    (params.localPaths !== undefined || params.localDirectory !== undefined)
  )
    return "A check may not hand the page files from this disk.";
  if (method === "newContext")
    for (const option of REFUSED_CONTEXT_OPTIONS)
      if (params[option] !== undefined) return `A check may not set a context's ${option}.`;
  if (method === "goto" && !isPlayOrigin(params.url, playUrl))
    return `A check may open only the played activity, not ${String(params.url)}.`;
  if (method === "continue" && params.url !== undefined && !isPlayOrigin(params.url, playUrl))
    return "A check may not send a request anywhere but the played activity.";
  return null;
}

export interface GuardedBrowser {
  /** Where a check connects: the guard, never the browser. */
  endpoint: string;
  close(): Promise<void>;
}

/**
 * Starts the locked-down browser behind its guard, both on loopback, for one play link, with
 * the `playwright-core` in `coreDir`.
 */
export async function startGuardedBrowser(
  executable: string,
  coreDir: string,
  args: readonly string[],
  playUrl: string,
): Promise<GuardedBrowser> {
  const { chromium } = createRequire(import.meta.url)(path.join(coreDir, "index.js")) as {
    chromium: {
      launchServer(options: {
        executablePath: string;
        headless: boolean;
        host: string;
        args: string[];
      }): Promise<{ wsEndpoint(): string; close(): Promise<void> }>;
    };
  };
  const browser = await chromium.launchServer({
    executablePath: executable,
    headless: true,
    host: "127.0.0.1",
    args: [...args, ...lockdownArgs(playUrl)],
  });
  const upstreamUrl = browser.wsEndpoint();
  const secret = `/${randomBytes(16).toString("hex")}`;
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
  server.on("connection", (client, request) => {
    if (request.url !== secret) {
      client.close(1008, "Not this way.");
      return;
    }
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers))
      if (typeof value === "string" && (key === "user-agent" || key.startsWith("x-playwright")))
        headers[key] = value;
    const upstream = new WebSocket(upstreamUrl, { headers });
    const waiting: string[] = [];
    upstream.on("open", () => {
      for (const text of waiting.splice(0)) upstream.send(text);
    });
    client.on("message", (data, binary) => {
      if (binary) return client.close(1003, "Text only.");
      const text = String(data);
      let message: { id?: unknown; guid?: unknown; method?: unknown; params?: unknown };
      try {
        message = JSON.parse(text) as typeof message;
      } catch {
        return client.close(1003, "Not a protocol message.");
      }
      const reason = vetCall(message, playUrl);
      if (reason) {
        client.send(
          JSON.stringify({
            id: message.id,
            error: { error: { name: "Error", message: reason, stack: `Error: ${reason}` } },
          }),
        );
        return;
      }
      if (upstream.readyState === WebSocket.OPEN) upstream.send(text);
      else waiting.push(text);
    });
    upstream.on("message", (data) => {
      if (client.readyState === WebSocket.OPEN) client.send(String(data));
    });
    client.on("close", () => upstream.close());
    upstream.on("close", () => client.close());
    upstream.on("error", () => client.close());
    client.on("error", () => upstream.close());
  });
  const { port } = server.address() as AddressInfo;
  return {
    endpoint: `ws://127.0.0.1:${port}${secret}`,
    close: async () => {
      for (const client of server.clients) client.terminate();
      server.close();
      await browser.close().catch(() => {});
    },
  };
}
