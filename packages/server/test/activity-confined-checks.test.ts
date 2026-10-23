/**
 * The checks the server runs itself (decision 17), for real: an earlier run's test file against a
 * page that answers the inspection bridge as a WAF module does, in a real browser, with this
 * server's harness and runner served from memory to a child Node under the permission model, the
 * browser locked to the play link behind its guard. What a check may not do — read or write this
 * disk, start a process, see the server's environment, open a local file or another port — fails
 * that check. Skipped where Playwright's Chromium is not installed, unless the run requires it.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isPlayOrigin, lockdownArgs, vetCall } from "../src/activities/browser-guard.js";
import {
  CHILD_SOURCE,
  runConfinedChecks,
  type ChecksOutcome,
} from "../src/activities/confined-checks.js";
import { playwrightCoreDir } from "../src/activities/test-browser.js";
import { installedChromium } from "./installed-chromium.js";

/** A module page that plays one case: a star to tap, then the end. */
const PAGE = `<!doctype html>
<html><body>
<button id="star" data-interactable-id="star"
  style="position:absolute;left:80px;top:80px;width:120px;height:120px">Star</button>
<script>
  const history = [];
  let current = null;
  function enter(state) {
    current = { state, sceneId: "sky", phase: state, index: history.length, interactive: state === "intro" };
    history.push({ ...current, details: {} });
  }
  enter("intro");
  document.getElementById("star").addEventListener("click", () => {
    if (current.state === "intro") enter("end");
  });
  window.Activity = {
    Inspection: {
      getSnapshot: () => ({ ...current }),
      getHistory: () => history.map((entry) => ({ ...entry })),
      getMediaHistory: () => [],
      getCurrentState: () => ({
        interactables: current.state === "intro" ? [{ id: "star", inputType: "tap" }] : [],
      }),
      waitForState: async (name, { timeoutMs = 5000, afterIndex = -1 } = {}) => {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
          const found = history.find((entry) => entry.index > afterIndex && entry.state === name);
          if (found) return found;
          if (Date.now() > deadline) throw new Error("No state " + name);
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      },
      waitForMedia: async () => null,
    },
  };
</script>
</body></html>
`;

const executable = installedChromium();
const coreDir = playwrightCoreDir();

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

/** Serves `body` at every path, counting the requests; answers its base URL. */
async function serve(body: string): Promise<{ url: string; hits: () => number }> {
  let hits = 0;
  const server = http.createServer((_request, response) => {
    hits += 1;
    response.writeHead(200, { "content-type": "text/html" });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => new Promise((resolve) => server.close(() => resolve())));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, hits: () => hits };
}

function input(playUrl: string, criteria: string[]) {
  return {
    playUrl,
    viewport: { width: 800, height: 600 },
    criteria,
    browserPath: executable ?? "",
    scenes: ["sky"],
    specRevision: "rev",
  };
}

async function run(
  test: string,
  playUrl: string,
  criteria: string[],
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ChecksOutcome> {
  return runConfinedChecks({
    test,
    input: input(playUrl, criteria),
    executable: executable!,
    coreDir: coreDir!,
    signal: options.signal ?? new AbortController().signal,
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  });
}

function results(outcome: ChecksOutcome) {
  if (!outcome.ran) throw new Error(`The checks did not run: ${outcome.reason}`);
  return (
    JSON.parse(outcome.results) as {
      results: { criterion: string; status: string; error: string | null }[];
    }
  ).results;
}

describe("the guard before the server's test browser", () => {
  const play = "http://127.0.0.1:7368/preview/activity/token/play";

  it("lets a page reach only the play link's host and port", () => {
    expect(lockdownArgs(play)).toEqual(
      expect.arrayContaining([
        "--proxy-server=http://127.0.0.1:9",
        "--proxy-bypass-list=<-loopback>;127.0.0.1:7368",
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
      ]),
    );
    expect(lockdownArgs("http://[::1]:7368/play")).toContain(
      "--proxy-bypass-list=<-loopback>;[::1]:7368",
    );
    expect(isPlayOrigin("http://127.0.0.1:7368/elsewhere", play)).toBe(true);
    for (const url of [
      "file:///etc/passwd",
      "http://127.0.0.1:7369/",
      "http://localhost:7368/",
      "https://127.0.0.1:7368/",
      "http://169.254.169.254/latest/meta-data",
    ])
      expect(isPlayOrigin(url, play), url).toBe(false);
  });

  it("passes a check's page work and refuses every way past the page", () => {
    expect(vetCall({ guid: "page@1", method: "goto", params: { url: play } }, play)).toBeNull();
    expect(vetCall({ guid: "frame@1", method: "click", params: {} }, play)).toBeNull();
    for (const [message, reason] of [
      [{ guid: "frame@1", method: "goto", params: { url: "file:///C:/" } }, "open only the played"],
      [{ guid: "browser@1", method: "newBrowserCDPSession" }, "may not use"],
      [{ guid: "browser@1", method: "newContext", params: { proxy: {} } }, "context's proxy"],
      [{ guid: "frame@1", method: "setInputFiles", params: { localPaths: ["x"] } }, "files"],
      [{ guid: "request-context@1", method: "fetch" }, "outside the browser"],
      [{ guid: "artifact@1", method: "saveAs" }, "may not use"],
      [{ guid: "tracing@1", method: "tracingStart" }, "may not use"],
    ] as const)
      expect(vetCall(message, play), JSON.stringify(message)).toContain(reason);
  });
});

describe.skipIf(!executable || !coreDir)("the server's own run of earlier checks", () => {
  it("runs the test file with its own harness, and reports each check as the page answers", async () => {
    const page = await serve(PAGE);
    const outcome = await run(
      `import { criterion, openActivity, expect } from "./activity-harness.mjs";
criterion("The star can be tapped.", async () => {
  const activity = await openActivity();
  await activity.tap("star");
  await activity.waitForState("end", { timeoutMs: 3000 });
});
criterion("It starts on the intro.", async () => {
  const activity = await openActivity();
  expect((await activity.state()).state === "intro", "It did not start on the intro.");
});
criterion("It is blue.", async () => {
  expect(false, "It is not blue.");
});
`,
      `${page.url}/play`,
      ["The star can be tapped.", "It starts on the intro.", "It is blue."],
    );
    expect(results(outcome)).toEqual([
      expect.objectContaining({ criterion: "The star can be tapped.", status: "passed" }),
      expect.objectContaining({ criterion: "It starts on the intro.", status: "passed" }),
      expect.objectContaining({
        criterion: "It is blue.",
        status: "failed",
        error: "It is not blue.",
      }),
    ]);
  }, 120_000);

  it("fails a check that reaches past the page or out of its process", async () => {
    const page = await serve(PAGE);
    const elsewhere = await serve("another service");
    const secretFile = path.join(os.tmpdir(), `wafh-checks-secret-${process.pid}.txt`);
    fs.writeFileSync(secretFile, "a secret");
    closers.push(async () => fs.rmSync(secretFile, { force: true }));
    process.env.WAFH_CHECKS_SECRET = "in the server's environment";
    closers.push(async () => {
      delete process.env.WAFH_CHECKS_SECRET;
    });
    const criteria = ["read", "write", "spawn", "env", "file", "port"];
    const outcome = await run(
      `import { criterion, openActivity, expect } from "./activity-harness.mjs";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
criterion("read", () => { fs.readFileSync(${JSON.stringify(secretFile)}, "utf8"); });
criterion("write", () => { fs.writeFileSync(${JSON.stringify(`${secretFile}.copy`)}, "x"); });
criterion("spawn", () => {
  const child = spawnSync(process.execPath, ["-v"]);
  if (child.error) throw child.error;
});
criterion("env", () => {
  expect(process.env.WAFH_CHECKS_SECRET === undefined, "It saw the server's environment.");
  // What Node needs, its IPC channel, and what each OS adds to every child on its own: Windows'
  // process spawning adds the profile variables, macOS CoreFoundation adds its text encoding.
  const needed = /^(PATH|TEMP|TMP|TMPDIR|SYSTEMROOT|WINDIR|NODE_CHANNEL_\\w+)$/i;
  const windows = /^(HOMEDRIVE|HOMEPATH|LOGONSERVER|SYSTEMDRIVE|USERDOMAIN|USERNAME|USERPROFILE)$/i;
  const macos = /^__CF_USER_TEXT_ENCODING$/;
  const kept = Object.keys(process.env).filter(
    (key) =>
      !needed.test(key) &&
      !(process.platform === "win32" && windows.test(key)) &&
      !(process.platform === "darwin" && macos.test(key)),
  );
  expect(kept.length === 0, "It was given more than Node needs: " + kept.join(", "));
});
criterion("file", async () => {
  const activity = await openActivity();
  await activity.page.goto(${JSON.stringify(`file:///${secretFile.replaceAll("\\", "/")}`)});
});
criterion("port", async () => {
  const activity = await openActivity();
  const reached = await activity.page.evaluate(async (url) => {
    try {
      await fetch(url, { mode: "no-cors" });
      return true;
    } catch {
      return false;
    }
  }, ${JSON.stringify(elsewhere.url)});
  expect(!reached, "The page reached another service.");
});
`,
      `${page.url}/play`,
      criteria,
    );
    const byCriterion = Object.fromEntries(
      results(outcome).map((entry) => [entry.criterion, entry]),
    );
    expect(byCriterion.read).toMatchObject({ status: "failed" });
    expect(byCriterion.read!.error).toMatch(/restricted|ERR_ACCESS_DENIED/);
    expect(byCriterion.write).toMatchObject({ status: "failed" });
    expect(fs.existsSync(`${secretFile}.copy`)).toBe(false);
    expect(byCriterion.spawn).toMatchObject({ status: "failed" });
    expect(byCriterion.env, JSON.stringify(byCriterion.env)).toMatchObject({ status: "passed" });
    expect(byCriterion.file).toMatchObject({ status: "failed" });
    expect(byCriterion.file!.error).toContain("A check may open only the played activity");
    expect(byCriterion.port).toMatchObject({ status: "passed" });
    expect(elsewhere.hits()).toBe(0);
  }, 120_000);

  it("says why the checks could not run: an import it refuses, a time limit, a stop", async () => {
    const page = await serve(PAGE);
    const refused = await run('import "./elsewhere.mjs";\n', `${page.url}/play`, ["Anything."]);
    expect(refused).toMatchObject({ ran: false });
    expect(!refused.ran && refused.reason).toContain(
      "A check may import only the harness and Node's own modules",
    );
    expect(!refused.ran && refused.reason).toMatch(/^The acceptance tests could not run: /);

    // What the child itself saw go wrong beats a line a check printed to look like the runner.
    const forged = await run(
      `import { runner } from "./activity-harness.mjs";
console.error("The acceptance tests could not run: a reason a check made up.");
runner.closeAll = () => { throw new Error("The runner was broken."); };
`,
      `${page.url}/play`,
      ["Anything."],
    );
    expect(forged).toEqual({
      ran: false,
      reason: "The acceptance tests could not run: The runner was broken.",
    });

    const stuck = await run("await new Promise(() => {});\n", `${page.url}/play`, ["Anything."], {
      timeoutMs: 3_000,
    });
    expect(stuck).toEqual({
      ran: false,
      reason: "The acceptance tests ran past their time limit (3 seconds) and were stopped.",
    });

    const controller = new AbortController();
    const stopping = run("await new Promise(() => {});\n", `${page.url}/play`, ["Anything."], {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 1_000);
    expect(await stopping).toEqual({ ran: false, reason: "The acceptance tests were stopped." });
  }, 120_000);
});

describe.skipIf(!coreDir)("the child that runs the checks", () => {
  it("refuses to run them unless Node's permission model confines it", async () => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", CHILD_SOURCE], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    const done = new Promise<unknown>((resolve) => child.on("message", resolve));
    child.send({
      base: "file:///nowhere/",
      runner: "run.mjs",
      files: {},
      shim: "",
      playwright: "",
    });
    expect(await done).toEqual({
      type: "done",
      failure: "Node's permission model is not confining the checks.",
    });
    await new Promise((resolve) => child.once("exit", resolve));
  }, 30_000);
});
