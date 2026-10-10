/**
 * The request log: one line per request, with the status the caller got. The platform
 * behind the seam used to log too, so every request came out twice and every page or
 * asset the platform passed on to static hosting was logged as a 404 first.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("request log", () => {
  let t: TestApp;
  let lines: string[];
  let webDist: string;

  beforeEach(async () => {
    lines = [];
    webDist = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-request-log-web-"));
    await fs.writeFile(path.join(webDist, "index.html"), "<html></html>");
    t = await createTestApp({ log: (line) => lines.push(line), config: { webDist } });
  });
  afterEach(async () => {
    await t.cleanup();
    await fs.rm(webDist, { recursive: true, force: true });
  });

  /** Requests `path` and returns its log lines, each reduced to the status it records. */
  async function request(path: string): Promise<{ status: number; logged: string[] }> {
    const res = await t.app.request(path);
    // The layer's log resolves the current platform before writing: let that settle.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const logged = lines
      .filter((line) => line.startsWith(`GET ${path} `))
      .map((line) => line.split(" ")[2]!);
    return { status: res.status, logged };
  }

  it("logs a page the platform passes on to static hosting once, as the 200 it was", async () => {
    const { status, logged } = await request("/activities");
    expect(status).toBe(200);
    expect(logged).toEqual(["200"]);
  });

  it("logs a request the platform answers once", async () => {
    const { status, logged } = await request("/api/auth/me");
    expect(logged).toEqual([String(status)]);
  });
});
