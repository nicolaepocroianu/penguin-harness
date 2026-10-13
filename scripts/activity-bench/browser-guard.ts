/**
 * The evaluator's browser, locked down. A check — a trial's own tests are its agent's code —
 * drives it over Playwright's protocol, and the browser itself runs unconfined, as this user:
 * left alone, a check could open `file:///…` and read anything the user can (their Claude
 * login, Penguin's vaults, the other side's trial home), or send it to any host.
 *
 * Two locks, neither of which the check can lift:
 *
 * - The network: Chromium starts with a proxy that leads nowhere for everything but the played
 *   module's own port on loopback; every host name but loopback resolves to nothing; and WebRTC
 *   may not send UDP around the proxy. A page reaches the played module and nothing else — not
 *   another service on this machine either.
 * - The protocol: the check never meets the browser's own endpoint. It connects to a guard
 *   that passes on only calls on the kinds of object the harness and a test's page work use,
 *   and of those refuses a navigation anywhere but the played module's origin, a context with
 *   its own proxy or recordings, files the browser would read from or write to this disk, raw
 *   DevTools sessions, the browser's own HTTP client, tracing and artifacts. A refused call
 *   fails in the check like any error.
 *
 * Chromium itself refuses a page's own way to a local file (a link, a redirect, `window.open`).
 */
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PACKAGE = path.resolve(HERE, "../../packages/server/package.json");

/** Chromium switches that leave a page only loopback to reach; `lockdownArgs` narrows it to one port. */
export const LOCKDOWN_ARGS = [
  // Everything goes to a port nothing answers on, but what the bypass list names.
  "--proxy-server=http://127.0.0.1:9",
  "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
  "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
  "--disable-background-networking",
  "--no-pings",
];

/** The loopback names a page may reach the played module's port by. */
const LOOPBACK = ["127.0.0.1", "localhost", "[::1]"];

/** The switches for one run: the lock, with only the played module's port let through. */
export function lockdownArgs(playUrl: string): string[] {
  const port = portOf(new URL(playUrl));
  // `<-loopback>` ends Chromium's own bypass of loopback: any other port goes nowhere too.
  const bypass = ["<-loopback>", ...LOOPBACK.map((host) => `${host}:${port}`)];
  return [...LOCKDOWN_ARGS, `--proxy-bypass-list=${bypass.join(";")}`];
}

function portOf(url: URL): string {
  return url.port || (url.protocol === "https:" ? "443" : "80");
}

/**
 * The kinds of protocol object a check may call (a guid's prefix): what the harness and a
 * test's work on its pages use. Every other kind is refused — the browser's types, DevTools
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

/** Whether a URL is the played module's origin: http(s), loopback, the play link's port. */
export function isPlayOrigin(value: unknown, playUrl: string): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      LOOPBACK.includes(url.hostname) &&
      portOf(url) === portOf(new URL(playUrl))
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
  // A context's own API client makes requests from the evaluator, not the browser.
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
    return `A check may open only the played module, not ${String(params.url)}.`;
  if (method === "continue" && params.url !== undefined && !isPlayOrigin(params.url, playUrl))
    return "A check may not send a request anywhere but the played module.";
  return null;
}

interface Socket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: string, listener: (...args: never[]) => void): void;
  once(event: string, listener: (...args: never[]) => void): void;
}

interface Playwright {
  chromium: {
    launchServer(options: {
      executablePath: string;
      headless: boolean;
      host: string;
      args: string[];
    }): Promise<{ wsEndpoint(): string; close(): Promise<void> }>;
  };
}

export interface GuardedBrowser {
  /** Where a check connects: the guard, never the browser. */
  endpoint: string;
  /** Calls the guard refused, as it worded them. */
  refused: string[];
  close(): Promise<void>;
}

/** Starts the locked-down browser behind its guard, both on loopback, for one played module. */
export async function startGuardedBrowser(
  playwright: Playwright,
  executablePath: string,
  args: readonly string[],
  playUrl: string,
): Promise<GuardedBrowser> {
  const { ws: WebSocket, wsServer: WebSocketServer } = createRequire(SERVER_PACKAGE)(
    "playwright-core/lib/utilsBundle",
  ) as {
    ws: new (url: string, options: { headers: Record<string, string> }) => Socket;
    wsServer: new (options: { host: string; port: number }) => {
      address(): AddressInfo;
      once(event: "listening", listener: () => void): void;
      on(
        event: "connection",
        listener: (
          socket: Socket,
          request: { url?: string; headers: Record<string, string | undefined> },
        ) => void,
      ): void;
      close(): void;
    };
  };
  const browser = await playwright.chromium.launchServer({
    executablePath,
    headless: true,
    host: "127.0.0.1",
    args: [...args, ...lockdownArgs(playUrl)],
  });
  const upstreamUrl = browser.wsEndpoint();
  const secret = `/${randomBytes(16).toString("hex")}`;
  const refused: string[] = [];
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
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
    client.on("message", (data: unknown, binary: unknown) => {
      if (binary) return client.close(1003, "Text only.");
      const text = String(data);
      let message: { id?: unknown; guid?: unknown; method?: unknown; params?: unknown };
      try {
        message = JSON.parse(text);
      } catch {
        return client.close(1003, "Not a protocol message.");
      }
      const reason = vetCall(message, playUrl);
      if (reason) {
        refused.push(reason);
        client.send(
          JSON.stringify({
            id: message.id,
            error: { error: { name: "Error", message: reason, stack: `Error: ${reason}` } },
          }),
        );
        return;
      }
      if (upstream.readyState === 1) upstream.send(text);
      else waiting.push(text);
    });
    upstream.on("message", (data: unknown) => {
      if (client.readyState === 1) client.send(String(data));
    });
    client.on("close", () => upstream.close());
    upstream.on("close", () => client.close());
    upstream.on("error", () => client.close());
    client.on("error", () => upstream.close());
  });
  const { port } = server.address();
  return {
    endpoint: `ws://127.0.0.1:${port}${secret}`,
    refused,
    close: async () => {
      server.close();
      await browser.close().catch(() => {});
    },
  };
}
