/**
 * An AuthoringHost that takes each trial through the real Stages: a Penguin server started from
 * the recipe's own commit, on a fresh home copied from the bench's seed, driven over the same
 * routes an author's App uses. The server under test is unchanged.
 *
 * The bench home (never ~/.penguin, never a running server's data root):
 *   seed/            a Penguin home a person prepares once: the Project, its default model, the
 *                    test browser, and for the non-regression check a Claude Code definition
 *   claude-config/   CLAUDE_CONFIG_DIR for Claude Code trials: a Claude login a person made
 *                    there, and nothing of their own ~/.claude (decision 19)
 *   recipes/<sha>/   a worktree of each commit compared, built once
 *   trials/...       one folder per trial: its home, and its server's log
 *
 * Every server is started with the system plumbing of this process's environment only, a
 * random port, and a desktop token that is its only credential; it is stopped with every
 * process it started before a trial's result is returned.
 */
import type { ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findChromium } from "./checks.js";
import { killTree, plainEnv, spawnTree } from "./process-tree.js";
import { git } from "./surface.js";
import {
  InfrastructureError,
  type AuthoredTrial,
  type AuthoringHost,
  type HiddenChecks,
  type PlaySession,
  type TrialPlan,
} from "./types.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const YAML = createRequire(path.resolve(HERE, "../../packages/server/package.json"))("yaml") as {
  parse(text: string): unknown;
};

const BOOT_TIMEOUT_MS = 180_000;
const POLL_MS = 5_000;
const DEFAULT_TRIAL_TIMEOUT_MS = 75 * 60_000;
const CLAUDE = "claude";

export interface BenchLayout {
  seed: string;
  claudeConfig: string;
  recipes: string;
  trials: string;
}

export function benchLayout(home: string): BenchLayout {
  return {
    seed: path.resolve(home, "seed"),
    claudeConfig: path.resolve(home, "claude-config"),
    recipes: path.resolve(home, "recipes"),
    trials: path.resolve(home, "trials"),
  };
}

export interface IsolatedServerOptions {
  /** The evaluator's checkout: each recipe's worktree is added from it. */
  repo: string;
  home: string;
  project: string;
  agentId: string;
  trialTimeoutMs?: number;
  log?: (line: string) => void;
}

interface Server {
  origin: string;
  call<T>(method: string, route: string, body?: unknown): Promise<T>;
  /** The redirect a route answers with, or null when it answers otherwise. */
  location(route: string): Promise<string | null>;
  stop(): Promise<void>;
}

/** What a trial leaves beside its home for scoring. */
interface TrialNote {
  activityId: string;
  testRunId: string | null;
}

export class IsolatedServer implements AuthoringHost {
  private readonly layout: BenchLayout;
  private readonly log: (line: string) => void;

  constructor(private readonly options: IsolatedServerOptions) {
    this.layout = benchLayout(options.home);
    this.log = options.log ?? (() => {});
  }

  async preflight(shas: string[]): Promise<{ refused: string } | { claude: true | string }> {
    const { seed } = this.layout;
    const { project, agentId } = this.options;
    if (!fs.existsSync(path.join(seed, project)))
      return { refused: `The seed home ${seed} has no Project ${project}.` };
    if (!(await findChromium(path.join(seed, "browsers"))))
      return { refused: `The seed home ${seed} has no test browser installed.` };
    for (const sha of new Set(shas)) {
      try {
        await this.recipe(sha);
      } catch (error) {
        return { refused: `Commit ${sha.slice(0, 12)} could not be prepared: ${message(error)}` };
      }
    }
    // One start on a throwaway copy: the seed serves, has the agent, and says whether Claude
    // Code can run from the bench's own folder.
    const dir = path.join(this.layout.trials, `preflight-${randomBytes(4).toString("hex")}`);
    let server: Server | null = null;
    try {
      this.copySeed(dir);
      server = await this.boot(shas[0]!, dir);
      const { agents } = await server.call<{ agents: { agentId: string }[] }>(
        "GET",
        `/api/projects/${project}/agents`,
      );
      if (!agents.some((agent) => agent.agentId === agentId))
        return { refused: `The seed's Project ${project} has no agent ${agentId}.` };
      const workspace = await this.workspace(server);
      if (workspace) return { refused: workspace };
      return { claude: await this.useClaude(server) };
    } catch (error) {
      return { refused: `The seed home did not start: ${message(error)}` };
    } finally {
      await server?.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  async author(trial: TrialPlan): Promise<AuthoredTrial> {
    const dir = this.folder(trial);
    fs.rmSync(dir, { recursive: true, force: true });
    this.copySeed(dir);
    const started = Date.now();
    const server = await this.boot(trial.sha, dir);
    try {
      const { project, agentId } = this.options;
      const workspace = await this.workspace(server);
      if (workspace) throw new InfrastructureError(workspace);
      if (trial.runtime === "coding:claude") {
        const ready = await this.useClaude(server);
        if (ready !== true) throw new InfrastructureError(ready);
      }
      const costBefore = await this.cost(server);
      await server.call("POST", `/api/projects/${project}/agents/${agentId}/plugins`, {
        names: ["waf-authoring"],
      });
      const activities = `/api/projects/${project}/activities`;
      const { request } = trial;
      const created = await server.call<{ id: string; draft: { contentRevision: string } }>(
        "POST",
        activities,
        {
          title: request.title,
          productCode: request.productCode,
          refNum: request.refNum,
          ...(request.activityType ? { activityType: request.activityType } : {}),
          ...(request.bookMode ? { bookMode: request.bookMode } : {}),
        },
      );
      const at = `${activities}/${created.id}`;
      let revision = (
        await server.call<{ contentRevision: string }>("PATCH", `${at}/description`, {
          description: request.script,
          expectedRevision: created.draft.contentRevision,
        })
      ).contentRevision;
      if (request.spec !== undefined)
        revision = (
          await server.call<{ contentRevision: string }>("POST", `${at}/apply-generated-spec`, {
            spec: request.spec,
            expectedRevision: revision,
          })
        ).contentRevision;
      if (request.media !== undefined)
        await server.call("PUT", `${at}/media`, {
          manifest: request.media,
          expectedRevision: revision,
        });
      const deadline = started + (this.options.trialTimeoutMs ?? DEFAULT_TRIAL_TIMEOUT_MS);
      let pipeline: AuthoredTrial["pipeline"] = "succeeded";
      const sessionIds: string[] = [];
      for (const stage of request.sequences) {
        await server.call("POST", `${at}/pipeline`, {
          stage,
          agentId,
          ...(trial.runtime === "coding:claude" ? { codingAgentId: CLAUDE } : {}),
        });
        const state = await this.settle(server, at, deadline);
        for (const step of state?.steps ?? [])
          if (step.sessionId && !sessionIds.includes(step.sessionId))
            sessionIds.push(step.sessionId);
        pipeline = state === null ? "timed_out" : (state.status as AuthoredTrial["pipeline"]);
        if (pipeline !== "succeeded") break;
      }
      const tested = await server.call<{
        runId: string | null;
        report: { results: { criterion: string; status: string }[] } | null;
      }>("GET", `${at}/test-report`);
      const history = await server
        .call<{ runs: { recipe: { runtime: string } | null }[] }>(
          "GET",
          `/api/admin/activity-outcomes/history?projectId=${project}&activityId=${created.id}`,
        )
        .catch(() => ({ runs: [] }));
      const answeredBy =
        history.runs
          .map((run) => run.recipe?.runtime ?? "")
          .find((runtime) => runtime.startsWith("agent:") || runtime.startsWith("coding:")) ?? null;
      const costAfter = await this.cost(server);
      const note: TrialNote = { activityId: created.id, testRunId: tested.runId };
      fs.writeFileSync(path.join(dir, "trial.json"), JSON.stringify(note));
      return {
        pipeline,
        costUsd:
          costBefore !== null && costAfter !== null ? Math.max(0, costAfter - costBefore) : null,
        durationMs: Date.now() - started,
        sessionIds,
        answeredBy,
        thinking: this.thinking(),
        selfReport:
          tested.report?.results.map(({ criterion, status }) => ({ criterion, status })) ?? null,
      };
    } finally {
      await server.stop();
    }
  }

  async traces(trial: TrialPlan): Promise<string[]> {
    const found = [this.folder(trial)];
    if (trial.runtime === "coding:claude")
      found.push(path.join(this.layout.claudeConfig, "projects"));
    return found;
  }

  async play(trial: TrialPlan): Promise<PlaySession | null> {
    const dir = this.folder(trial);
    const note = JSON.parse(fs.readFileSync(path.join(dir, "trial.json"), "utf8")) as TrialNote;
    // A fresh start: a fresh play-link secret, and no graded process from before.
    const server = await this.boot(trial.sha, dir);
    const where = await server
      .location(`/api/projects/${this.options.project}/activities/${note.activityId}/sandbox/play`)
      .catch(() => null);
    if (!where) {
      await server.stop();
      return null;
    }
    return {
      playUrl: new URL(where, server.origin).toString(),
      ownTests: note.testRunId ? this.ownTests(dir, note.testRunId) : null,
      close: () => server.stop(),
    };
  }

  async discard(trial: TrialPlan): Promise<void> {
    fs.rmSync(this.folder(trial), { recursive: true, force: true });
  }

  /**
   * A fresh home for one trial: the seed, all but its test browser, which every trial uses
   * where the seed keeps it (PENGUIN_BUNDLED_BROWSERS) rather than a copy of its own.
   */
  private copySeed(dir: string): void {
    const browsers = path.join(this.layout.seed, "browsers");
    fs.cpSync(this.layout.seed, path.join(dir, "home"), {
      recursive: true,
      verbatimSymlinks: true,
      filter: (source) => path.resolve(source) !== browsers,
    });
  }

  /** The tests a trial's test run wrote, as its run folder holds them; null when there are none. */
  private ownTests(dir: string, runId: string): HiddenChecks | null {
    const run = path.join(dir, "home", "activity-runs", runId);
    try {
      const test = fs.readFileSync(path.join(run, "acceptance.test.mjs"), "utf8");
      const input = JSON.parse(
        fs.readFileSync(path.join(run, "acceptance-input.json"), "utf8"),
      ) as {
        criteria: string[];
        scenes: string[];
        viewport: { width: number; height: number };
      };
      return { test, criteria: input.criteria, scenes: input.scenes, viewport: input.viewport };
    } catch {
      return null;
    }
  }

  /** The commit's worktree, added and built the first time it is asked for. */
  private async recipe(sha: string): Promise<string> {
    const dir = path.join(this.layout.recipes, sha);
    const ready = path.join(dir, ".bench-ready");
    if (fs.existsSync(ready)) return dir;
    if (!fs.existsSync(dir)) {
      this.log(`Adding a worktree for ${sha.slice(0, 12)}.`);
      await git(this.options.repo, ["worktree", "add", "--detach", dir, sha]);
    }
    this.log(`Installing and building ${sha.slice(0, 12)}.`);
    await new Promise<void>((resolve, reject) => {
      const child = spawnTree(process.execPath, [path.join("scripts", "dev-prebuild.mjs")], {
        cwd: dir,
        env: plainEnv(),
        stdio: "ignore",
      });
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`the build exited with ${code}`)),
      );
    });
    fs.writeFileSync(ready, `${new Date().toISOString()}\n`);
    return dir;
  }

  /** Starts a server from the commit's worktree on `<dir>/home`, signed in as its admin. */
  private async boot(sha: string, dir: string): Promise<Server> {
    const worktree = await this.recipe(sha);
    const home = path.join(dir, "home");
    const portFile = path.join(dir, "server.port");
    fs.rmSync(portFile, { force: true });
    const token = randomBytes(24).toString("hex");
    const log = fs.openSync(path.join(dir, "server.log"), "a");
    const child = spawnTree(
      process.execPath,
      [path.join(worktree, "node_modules", "tsx", "dist", "cli.mjs"), path.join("src", "index.ts")],
      {
        cwd: path.join(worktree, "packages", "server"),
        env: plainEnv({
          PENGUIN_HOME: home,
          HOST: "127.0.0.1",
          PORT: "0",
          PENGUIN_PORT_FILE: portFile,
          PENGUIN_DESKTOP_TOKEN: token,
          // The seed's workspace is prepared once, by a person: a trial home never clones.
          PENGUIN_WAF_AUTO_PREPARE: "0",
          PENGUIN_BUNDLED_BROWSERS: path.join(this.layout.seed, "browsers"),
          CLAUDE_CONFIG_DIR: this.layout.claudeConfig,
        }),
        stdio: ["ignore", log, log],
      },
    );
    fs.closeSync(log);
    let origin = "";
    const stop = async () => {
      if (origin) {
        await fetch(`${origin}/api/desktop/shutdown`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
        }).catch(() => {});
        await Promise.race([
          new Promise((resolve) => child.once("exit", resolve)),
          new Promise((resolve) => setTimeout(resolve, 10_000)),
        ]);
      }
      await killTree(child);
    };
    try {
      const port = await this.waitForPort(child, portFile);
      // Bound to 127.0.0.1, a server answers its API on localhost and plays previews on
      // 127.0.0.1 (app.ts, the canonical-host guard): the play link comes back absolute.
      origin = `http://localhost:${port}`;
      const claimed = await fetch(`${origin}/api/auth/claim?token=${token}`, {
        redirect: "manual",
      });
      const cookie = /penguin_session=[^;]+/.exec(claimed.headers.get("set-cookie") ?? "")?.[0];
      if (!cookie) throw new InfrastructureError("The bench server did not sign the bench in.");
      return {
        origin,
        call: (method, route, body) => call(origin, cookie, method, route, body),
        location: async (route) => {
          const response = await fetch(`${origin}${route}`, {
            headers: { cookie },
            redirect: "manual",
          });
          return response.status >= 300 && response.status < 400
            ? response.headers.get("location")
            : null;
        },
        stop,
      };
    } catch (error) {
      await stop();
      const tail = readTail(path.join(dir, "server.log"));
      throw new InfrastructureError(`${message(error)}${tail ? `\n${tail}` : ""}`);
    }
  }

  private async waitForPort(child: ChildProcess, portFile: string): Promise<number> {
    const deadline = Date.now() + BOOT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`The bench server exited (${child.exitCode}).`);
      try {
        const port = Number(fs.readFileSync(portFile, "utf8").trim());
        if (Number.isInteger(port) && port > 0) return port;
      } catch {
        // Not written yet.
      }
      await sleep(250);
    }
    throw new Error("The bench server did not start in time.");
  }

  /** Waits until the sequence ends; stops it and answers null when the trial runs out of time. */
  private async settle(
    server: Server,
    at: string,
    deadline: number,
  ): Promise<{ status: string; steps: { sessionId?: string | null }[] } | null> {
    for (;;) {
      const { pipeline } = await server.call<{
        pipeline: { status: string; steps: { sessionId?: string | null }[] } | null;
      }>("GET", `${at}/pipeline`);
      if (pipeline && pipeline.status !== "running") return pipeline;
      if (Date.now() > deadline) {
        await server.call("POST", `${at}/pipeline/stop`).catch(() => {});
        return null;
      }
      await sleep(POLL_MS);
    }
  }

  /**
   * Points the trial home's Claude Code at the bench's own folder and asks the server whether it
   * can run from there. The bench never reads or copies a login; the server's own sign-in check
   * does, and only in the bench's folder (or an API key a person gave the seed's definition).
   */
  private async useClaude(server: Server): Promise<true | string> {
    const { agents } = await server.call<{
      agents: { id: string; env?: { key: string }[] }[];
    }>("GET", "/api/coding-agents/agents");
    const definition = agents.find((agent) => agent.id === CLAUDE);
    if (!definition) return "The seed home has no Claude Code coding agent.";
    const kept = (definition.env ?? [])
      .filter((entry) => entry.key !== "CLAUDE_CONFIG_DIR")
      .map((entry) => ({ key: entry.key }));
    await server.call("PUT", `/api/coding-agents/agents/${CLAUDE}/env`, {
      entries: [...kept, { key: "CLAUDE_CONFIG_DIR", value: this.layout.claudeConfig }],
    });
    const { candidates } = await server.call<{
      candidates: { recipeId: string; detected: boolean; authStatus?: string }[];
    }>("GET", "/api/coding-agents/discover");
    const claude = candidates.find((candidate) => candidate.recipeId === CLAUDE);
    if (!claude?.detected) return "Claude Code is not installed on this machine.";
    if (claude.authStatus !== "ok")
      return `No Claude login in ${this.layout.claudeConfig}: sign in there once, or give the seed's Claude Code definition an ANTHROPIC_API_KEY.`;
    return true;
  }

  /**
   * Why the trial home's WAF workspace cannot be used, or null. It must be the seed's own,
   * prepared there: a checkout outside the home would be shared by every trial, and a trial
   * never clones one itself.
   */
  private async workspace(server: Server): Promise<string | null> {
    const { status } = await server.call<{
      status: { managed: boolean; ready: boolean; lastError: string | null };
    }>("GET", "/api/admin/waf-workspace");
    if (!status.managed)
      return "The seed names a WAF checkout outside it, which every trial would share: let Penguin prepare one in the seed instead.";
    if (!status.ready)
      return `The seed's WAF workspace is not prepared${status.lastError ? `: ${status.lastError}` : "."}`;
    return null;
  }

  private async cost(server: Server): Promise<number | null> {
    try {
      const usage = await server.call<{ summary: { total: { cost: number | null } } }>(
        "GET",
        `/api/projects/${this.options.project}/usage`,
      );
      return usage.summary.total.cost;
    } catch {
      return null;
    }
  }

  /** The agent's thinking level as the seed sets it; agent configs default to medium. */
  private thinking(): string | null {
    const file = path.join(
      this.layout.seed,
      this.options.project,
      "agents",
      this.options.agentId,
      "agent_state",
      "system_config.yaml",
    );
    try {
      const config = YAML.parse(fs.readFileSync(file, "utf8")) as {
        model?: { thinking_level?: unknown };
      };
      const level = config?.model?.thinking_level;
      return typeof level === "string" && level ? level : "medium";
    } catch {
      return null;
    }
  }

  private folder(trial: TrialPlan): string {
    return path.join(this.layout.trials, ...trial.id.split("/"));
  }
}

async function call<T>(
  origin: string,
  cookie: string,
  method: string,
  route: string,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${origin}${route}`, {
      method,
      headers: {
        cookie,
        origin,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    throw new InfrastructureError(
      `${method} ${route} did not reach the bench server: ${message(error)}`,
    );
  }
  const text = await response.text();
  if (!response.ok)
    throw new InfrastructureError(
      `${method} ${route} answered ${response.status}: ${text.slice(0, 500)}`,
    );
  return (text ? JSON.parse(text) : null) as T;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readTail(file: string): string {
  try {
    return fs.readFileSync(file, "utf8").slice(-2000).trim();
  } catch {
    return "";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
