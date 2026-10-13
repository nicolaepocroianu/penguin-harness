/**
 * `pnpm bench seed` (scripts/activity-bench/seed.ts), taken through its steps against a server
 * in this process with git, npm and the browser installer stood in: the Project and its agent,
 * the default model with a key typed at a scripted prompt, the WAF workspace, the test browser,
 * bench.json, the preflight. The key is a fake; it must reach the server's model table and
 * nothing else — not a log, not bench.json, not argv. Run again, nothing is asked or redone.
 * The command's own refusals (no terminal, a bench home it may not use) run the real CLI.
 */
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkSeedServer, benchLayout } from "../../../scripts/activity-bench/isolated-server.js";
import { NoTerminal, hiddenFrom, type Prompter } from "../../../scripts/activity-bench/prompt.js";
import {
  SeedRefusal,
  projectIdOf,
  readBenchConfig,
  redact,
  seedBench,
  type SeedPorts,
} from "../../../scripts/activity-bench/seed.js";
import { bootEnv, type Server } from "../../../scripts/activity-bench/server-boot.js";
import { INSTALL_MARKER } from "../src/activities/test-browser.js";
import { FakeClones } from "./fake-clones.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const CLI = path.join(REPO, "scripts", "activity-bench", "cli.ts");
const TSX = path.join(REPO, "node_modules", "tsx", "dist", "cli.mjs");
/** Not a credential: the shape of one, so its absence everywhere can be asserted. */
const FAKE_KEY = "FAKE-KEY-FOR-THIS-TEST-ONLY-0123456789";

const temps: string[] = [];
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const cleanup of cleanups.splice(0)) await cleanup();
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-bench-seed-"));
  temps.push(dir);
  return dir;
}

/** Answers from a list; asking more than it holds is the failure a repeated run must not have. */
function scriptedPrompter(answers: string[]) {
  const asked: string[] = [];
  const next = (question: string) => {
    asked.push(question);
    const answer = answers.shift();
    if (answer === undefined) throw new Error(`Nothing scripted for: ${question}`);
    return Promise.resolve(answer);
  };
  const prompt: Prompter = {
    ask: next,
    hidden: next,
    confirm: async (question) => (await next(question)) === "y",
  };
  return { prompt, asked };
}

/**
 * A fresh server in this process on an empty home, as the seed's throwaway server is: git
 * answers from memory, npm makes a node_modules, the browser installer writes a Chromium.
 */
async function seedServer(options: { failClone?: string; externalCheckout?: boolean } = {}) {
  vi.stubEnv("WAF_ROOT_DIR", "");
  const clones = new FakeClones();
  if (options.failClone)
    clones.failClone = { remote: options.failClone, stderr: "fatal: could not read from remote" };
  const lines: string[] = [];
  const t = await createTestApp({
    wafCheckout: options.externalCheckout === true,
    log: (line) => lines.push(line),
    wafWorkspacePorts: {
      clones,
      runProcess: async (_command, _args, run) => {
        await fs.promises.mkdir(path.join(run.cwd, "node_modules"), { recursive: true });
        return { code: 0, tail: "" };
      },
    },
    testBrowserPorts: {
      locateExecutable: async (dir) => path.join(dir, "chromium-0000", "chrome"),
      runInstall: async (spec) => {
        const dir = path.join(spec.browsersDir, "chromium-0000");
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.writeFile(path.join(dir, "chrome"), "fake browser");
        await fs.promises.writeFile(path.join(dir, INSTALL_MARKER), "");
        return { result: "ok", log: "" };
      },
    },
  });
  cleanups.push(t.cleanup);
  const cookie = (await loginAdmin(t.app)).cookie;
  const admin = apiClient(t.app, cookie);
  const server: Server = {
    origin: "http://seed.test",
    async call(method, route, body) {
      const response = await t.app.request(route, {
        method,
        headers: { cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`${method} ${route} answered ${response.status}: ${text}`);
      return (text ? JSON.parse(text) : null) as never;
    },
    location: async () => null,
    stop: async () => {},
  };
  return { t, admin, server, lines, clones };
}

/** The seed's ports over one in-process server; the preflight asks that server as the bench does. */
function ports(
  server: Server,
  home: string,
  prompt: Prompter,
): SeedPorts & { log: (line: string) => void; logged: string[] } {
  const logged: string[] = [];
  return {
    server: async () => server,
    prompt,
    preflight: () => checkSeedServer(server, benchLayout(home), "bench", "activity_agent"),
    log: (line) => logged.push(line),
    logged,
  };
}

const options = (home: string, extra: { model?: string } = {}) => ({
  home,
  projectName: "Bench",
  agentId: "activity_agent",
  mainRef: "origin/main",
  trialEstimateUsd: 3,
  pollMs: 5,
  ...extra,
});

describe("preparing the seed", () => {
  it("makes the Project id from the name, and refuses a name that makes none", () => {
    expect(projectIdOf("Bench")).toBe("bench");
    expect(projectIdOf("Waterford bench 2")).toBe("waterford_bench_2");
    expect(() => projectIdOf("2026")).toThrow(SeedRefusal);
    expect(() => projectIdOf("-")).toThrow(SeedRefusal);
  });

  it("prepares every step, keeps the key in the Project only, and does nothing twice", async () => {
    const home = tempDir();
    fs.writeFileSync(
      path.join(home, "bench.json"),
      `${JSON.stringify({ vault: "vault/waterford.sealed", note: "kept" })}\n`,
    );
    const s = await seedServer();
    // The model is picked at the prompt, by its number; then its key, typed hidden.
    const first = scriptedPrompter(["2", FAKE_KEY]);
    const run = ports(s.server, home, first.prompt);
    const report = await seedBench(options(home), run);
    expect(report).toMatchObject({ projectId: "bench", ready: true, missing: [] });
    expect(first.asked).toEqual([
      "Default model (a number or provider/modelId): ",
      `API key for ${report.model} (typed hidden): `,
    ]);

    // The Project, with the built-in Activity Agent.
    const { projects } = (await (await s.admin.get("/api/projects")).json()) as {
      projects: { projectId: string; name?: string }[];
    };
    expect(projects.find((project) => project.projectId === "bench")).toMatchObject({
      projectId: "bench",
      name: "Bench",
    });
    const { agents } = (await (await s.admin.get("/api/projects/bench/agents")).json()) as {
      agents: { agentId: string }[];
    };
    expect(agents.map((agent) => agent.agentId)).toContain("activity_agent");
    // The default model is the second one offered, and it holds the key.
    const models = (await (await s.admin.get("/api/projects/bench/models")).json()) as {
      defaultModel: { provider: string; modelId: string };
      models: { provider: string; modelId: string; credential?: { apiKeyMasked?: string } }[];
    };
    const chosen = models.models[1]!;
    expect(report.model).toBe(`${chosen.provider}/${chosen.modelId}`);
    expect(models.defaultModel).toEqual({ provider: chosen.provider, modelId: chosen.modelId });
    expect(chosen.credential?.apiKeyMasked).toBeTruthy();
    expect(models.models.filter((row) => row.credential?.apiKeyMasked)).toHaveLength(1);
    // The WAF workspace Penguin prepared in the home, and the browser it installed there.
    const { status } = (await (await s.admin.get("/api/admin/waf-workspace")).json()) as {
      status: { managed: boolean; ready: boolean; root: string };
    };
    expect(status).toMatchObject({ managed: true, ready: true });
    expect(status.root.startsWith(s.t.root)).toBe(true);
    expect(s.clones.ops().filter((op) => op === "cloneFrom")).toHaveLength(4);
    const { browser } = (await (await s.admin.get("/api/admin/test-browser")).json()) as {
      browser: { installed: boolean; path: string };
    };
    expect(browser.installed).toBe(true);
    expect(browser.path.startsWith(s.t.root)).toBe(true);
    // bench.json: the fields the bench reads, and what was already there.
    const config = JSON.parse(fs.readFileSync(path.join(home, "bench.json"), "utf8"));
    expect(config).toEqual({
      vault: "vault/waterford.sealed",
      note: "kept",
      project: "bench",
      agent: "activity_agent",
      trialEstimateUsd: 3,
      mainRef: "origin/main",
    });
    expect(run.logged.some((line) => line.includes("The seed is ready"))).toBe(true);

    // The key went to the server's model table and nowhere else.
    for (const [where, text] of [
      ["the seed's log", run.logged.join("\n")],
      ["the server's log", s.lines.join("\n")],
      ["bench.json", JSON.stringify(config)],
      ["argv", process.argv.join(" ")],
      ["the report", JSON.stringify(report)],
      ["the questions", first.asked.join("\n")],
    ])
      expect(text, where).not.toContain(FAKE_KEY);
    // The masked key the server shows is not the key either.
    expect(JSON.stringify(models)).not.toContain(FAKE_KEY);
    // On disk, the key is in the Project's own config and in no other file of the home.
    const holding = filesHolding(s.t.root, FAKE_KEY);
    expect(holding.length).toBeGreaterThan(0);
    for (const file of holding) expect(path.basename(file)).toBe(".project_config.toml");
    expect(filesHolding(home, FAKE_KEY)).toEqual([]);

    // Again: every step is found done; nothing is asked, cloned or installed again.
    const again = scriptedPrompter([]);
    const rerun = ports(s.server, home, again.prompt);
    const second = await seedBench(options(home), rerun);
    expect(second).toMatchObject({ projectId: "bench", model: report.model, ready: true });
    expect(again.asked).toEqual([]);
    expect(rerun.logged).toEqual([
      "Project bench is already there.",
      "Agent activity_agent is in Project bench.",
      `Default model ${report.model} is set and has its key.`,
      "The WAF workspace is prepared.",
      "The test browser is installed.",
      `Wrote ${path.join(home, "bench.json")}.`,
      expect.stringContaining("The seed is ready"),
    ]);
    expect(s.clones.ops().filter((op) => op === "cloneFrom")).toHaveLength(4);
    expect(JSON.parse(fs.readFileSync(path.join(home, "bench.json"), "utf8"))).toEqual(config);
  });

  it("takes the model from --model and asks only for its key", async () => {
    const home = tempDir();
    const s = await seedServer();
    // A model the Project does not offer is refused, after the Project is made.
    await expect(
      seedBench(
        options(home, { model: "nowhere/none" }),
        ports(s.server, home, scriptedPrompter([]).prompt),
      ),
    ).rejects.toThrow(/is not a model this Project offers/);
    const models = (await (await s.admin.get("/api/projects/bench/models")).json()) as {
      models: { provider: string; modelId: string }[];
    };
    const pick = models.models[0]!;
    const asked = scriptedPrompter([FAKE_KEY]);
    const report = await seedBench(
      options(home, { model: `${pick.provider}/${pick.modelId}` }),
      ports(s.server, home, asked.prompt),
    );
    expect(report.model).toBe(`${pick.provider}/${pick.modelId}`);
    expect(asked.asked).toEqual([`API key for ${report.model} (typed hidden): `]);
    expect(report.ready).toBe(true);
  });

  it("refuses an empty key, a checkout from elsewhere, and a workspace git cannot clone", async () => {
    const home = tempDir();
    const empty = await seedServer();
    await expect(
      seedBench(options(home), ports(empty.server, home, scriptedPrompter(["1", "  "]).prompt)),
    ).rejects.toThrow(/No API key was typed/);

    const external = await seedServer({ externalCheckout: true });
    await expect(
      seedBench(
        options(home),
        ports(external.server, home, scriptedPrompter(["1", FAKE_KEY]).prompt),
      ),
    ).rejects.toThrow(/names a WAF checkout outside it/);

    const unreachable = await seedServer({
      failClone: "git@github.com:waterfordresearchinstitute/waf-framework.git",
    });
    const failed = ports(unreachable.server, home, scriptedPrompter(["1", FAKE_KEY]).prompt);
    await expect(seedBench(options(home), failed)).rejects.toThrow(
      /git could not reach or clone a repository/,
    );
    expect(failed.logged.join("\n")).not.toContain(FAKE_KEY);
  });

  it("stops before anything starts without a terminal, or in a home the bench may not use", () => {
    const run = (...args: string[]) =>
      spawnSync(process.execPath, [TSX, CLI, "seed", ...args], {
        cwd: REPO,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PENGUIN_BENCH_HOME: "" },
        timeout: 60_000,
      });
    const home = tempDir();
    const noTerminal = run("--home", home);
    expect(noTerminal.status).toBe(64);
    expect(noTerminal.stderr).toContain("run at a terminal");
    expect(fs.existsSync(path.join(home, "seed-server"))).toBe(false);
    const inRepo = run("--home", path.join(REPO, "bench-home"));
    expect(inRepo.status).toBe(64);
    expect(inRepo.stderr).toContain("give the bench a folder of its own");
  });

  it("starts every bench server with the bench's own Claude folder, never the person's", () => {
    vi.stubEnv("CLAUDE_CONFIG_DIR", path.join(os.homedir(), ".claude"));
    vi.stubEnv("ANTHROPIC_API_KEY", "not-for-the-server");
    vi.stubEnv("PENGUIN_HOME", path.join(os.homedir(), ".penguin"));
    const env = bootEnv(
      { home: "/bench/seed", claudeConfig: "/bench/claude-config", env: { PENGUIN_X: "1" } },
      "/bench/seed-server/server.port",
      "token",
    );
    expect(env).toMatchObject({
      CLAUDE_CONFIG_DIR: "/bench/claude-config",
      PENGUIN_HOME: "/bench/seed",
      PENGUIN_DESKTOP_TOKEN: "token",
      HOST: "127.0.0.1",
      PORT: "0",
      PENGUIN_X: "1",
    });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    // The plumbing stays (the server needs PATH and a home directory to run at all).
    expect(env.PATH ?? env.Path).toBeTruthy();
  });

  it("repeats nothing the server answered with the key in it, as typed or as JSON", async () => {
    const home = tempDir();
    const key = 'FAKE"KEY\\with-escapes-only-for-this-test';
    const s = await seedServer();
    const echoing: Server = {
      ...s.server,
      call: (method, route, body) => {
        if (method === "PUT" && route.endsWith("/models"))
          throw new Error(`400: ${JSON.stringify(body)} and plainly ${key}`);
        return s.server.call(method, route, body);
      },
    };
    const run = ports(echoing, home, scriptedPrompter(["1", key]).prompt);
    let refused = "";
    await seedBench(options(home), run).catch((error: Error) => {
      refused = error.message;
    });
    expect(refused).toContain("The default model could not be set");
    expect(refused).toContain("<the key>");
    expect(refused).not.toContain(key);
    expect(refused).not.toContain(JSON.stringify(key).slice(1, -1));
    expect(run.logged.join("\n")).not.toContain("with-escapes-only");
    expect(redact('a FAKE\\"KEY b', 'FAKE"KEY')).toBe("a <the key> b");
  });

  it("fills in a bench.json that is there, and refuses one it cannot keep", async () => {
    const home = tempDir();
    expect(readBenchConfig(home)).toEqual({});
    fs.writeFileSync(path.join(home, "bench.json"), '{ "vault": "vault/x.sealed" }\n');
    expect(readBenchConfig(home)).toEqual({ vault: "vault/x.sealed" });
    fs.writeFileSync(path.join(home, "bench.json"), "{ not json\n");
    expect(() => readBenchConfig(home)).toThrow(/is not JSON/);
    fs.writeFileSync(path.join(home, "bench.json"), "[]\n");
    expect(() => readBenchConfig(home)).toThrow(/must hold a JSON object/);
    // Refused before any server is started.
    let started = 0;
    const s = await seedServer();
    const run = ports(s.server, home, scriptedPrompter([]).prompt);
    run.server = async () => {
      started++;
      return s.server;
    };
    await expect(seedBench(options(home), run)).rejects.toThrow(SeedRefusal);
    expect(started).toBe(0);
    expect(fs.readFileSync(path.join(home, "bench.json"), "utf8")).toBe("[]\n");
  });

  it("stops asking for a hidden line when the terminal's input ends", async () => {
    const input = () => {
      const stdin = new EventEmitter() as EventEmitter & {
        isTTY: boolean;
        setRawMode(mode: boolean): void;
        setEncoding(encoding: string): void;
        resume(): void;
        pause(): void;
      };
      stdin.isTTY = true;
      stdin.setRawMode = () => {};
      stdin.setEncoding = () => {};
      stdin.resume = () => {};
      stdin.pause = () => {};
      return stdin;
    };
    const written: string[] = [];
    const out = { write: (text: string) => written.push(text) };
    const typed = input();
    const line = hiddenFrom("Key: ", typed, out);
    typed.emit("data", "ab");
    typed.emit("data", "c\u007f\r");
    await expect(line).resolves.toBe("ab");
    const ended = input();
    const noLine = hiddenFrom("Key: ", ended, out);
    ended.emit("end");
    await expect(noLine).rejects.toThrow(NoTerminal);
    const ctrlD = input();
    const cut = hiddenFrom("Key: ", ctrlD, out);
    ctrlD.emit("data", "ab\u0004");
    await expect(cut).rejects.toThrow(/ended before a line/);
    const notTerminal = input();
    notTerminal.isTTY = false;
    await expect(hiddenFrom("Key: ", notTerminal, out)).rejects.toThrow(NoTerminal);
    // Nothing typed reached the output: the question and the line ends only.
    expect(written.join("")).not.toContain("ab");
  });
});

/** Every file under `root` whose text holds `needle`. */
function filesHolding(root: string, needle: string): string[] {
  const found: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && fs.readFileSync(full, "latin1").includes(needle)) found.push(full);
    }
  };
  visit(root);
  return found;
}
