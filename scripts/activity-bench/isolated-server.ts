/**
 * An AuthoringHost that takes each trial through the real Stages: a Penguin server started from
 * the recipe's own commit, on a fresh home copied from the bench's seed, driven over the same
 * routes an author's App uses. The server under test is unchanged.
 *
 * The bench home (never ~/.penguin, never a running server's data root):
 *   seed/            a Penguin home `pnpm bench seed` prepares: the Project, its default model,
 *                    the WAF workspace, the test browser, and for the non-regression check a
 *                    Claude Code definition
 *   claude-config/   CLAUDE_CONFIG_DIR for Claude Code trials: a Claude login a person made
 *                    there, and nothing of their own ~/.claude (decision 19)
 *   recipes/<sha>/   a worktree of each commit compared, built once
 *   trials/...       one folder per trial: its home, and its server's log
 *
 * Every server is started with the system plumbing of this process's environment only, a
 * random port, and a desktop token that is its only credential (server-boot.ts); it is stopped
 * with every process it started before a trial's result is returned.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findChromium } from "./checks.js";
import { plainEnv, spawnTree } from "./process-tree.js";
import { bootServer, message, sleep, type Server } from "./server-boot.js";
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

/** What a trial leaves beside its home for scoring. */
interface TrialNote {
  activityId: string;
  testRunId: string | null;
}

/** Whether trials can run on a seed, asked of a server on it: a refusal says why. */
export type SeedCheck = { refused: string } | { claude: true | string };

/**
 * What a seed must have, asked of a server running on a copy of it: the agent in the Project,
 * a WAF workspace Penguin prepared in the seed, and whether Claude Code can run from the
 * bench's own folder.
 */
export async function checkSeedServer(
  server: Server,
  layout: BenchLayout,
  project: string,
  agentId: string,
): Promise<SeedCheck> {
  const { agents } = await server.call<{ agents: { agentId: string }[] }>(
    "GET",
    `/api/projects/${project}/agents`,
  );
  if (!agents.some((agent) => agent.agentId === agentId))
    return { refused: `The seed's Project ${project} has no agent ${agentId}.` };
  const problem = await workspace(server);
  if (problem) return { refused: problem };
  return { claude: await useClaude(server, layout) };
}

export interface SeedPreflightOptions {
  /** The checkout the throwaway server runs from. */
  worktree: string;
  layout: BenchLayout;
  project: string;
  agentId: string;
}

/**
 * The bench's preflight of a seed: its Project and test browser are there, and one start on a
 * throwaway copy says the rest (checkSeedServer). The seed itself is never started or changed.
 */
export async function seedPreflight(options: SeedPreflightOptions): Promise<SeedCheck> {
  const { layout, project, agentId } = options;
  if (!fs.existsSync(path.join(layout.seed, project)))
    return { refused: `The seed home ${layout.seed} has no Project ${project}.` };
  if (!(await findChromium(path.join(layout.seed, "browsers"))))
    return { refused: `The seed home ${layout.seed} has no test browser installed.` };
  const dir = path.join(layout.trials, `preflight-${randomBytes(4).toString("hex")}`);
  let server: Server | null = null;
  try {
    copySeed(layout, dir);
    server = await bootTrial(options.worktree, layout, dir);
    return await checkSeedServer(server, layout, project, agentId);
  } catch (error) {
    return { refused: `The seed home did not start: ${message(error)}` };
  } finally {
    await server?.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Starts a server from `worktree` on `<dir>/home`, a copy of the seed, as a trial runs one. */
function bootTrial(worktree: string, layout: BenchLayout, dir: string): Promise<Server> {
  return bootServer({
    worktree,
    home: path.join(dir, "home"),
    dir,
    env: {
      // The seed's workspace is prepared once, by a person: a trial home never clones.
      PENGUIN_WAF_AUTO_PREPARE: "0",
      PENGUIN_BUNDLED_BROWSERS: path.join(layout.seed, "browsers"),
      CLAUDE_CONFIG_DIR: layout.claudeConfig,
    },
  });
}

/**
 * A fresh home for one trial: the seed, all but its test browser, which every trial uses
 * where the seed keeps it (PENGUIN_BUNDLED_BROWSERS) rather than a copy of its own.
 */
function copySeed(layout: BenchLayout, dir: string): void {
  const browsers = path.join(layout.seed, "browsers");
  fs.cpSync(layout.seed, path.join(dir, "home"), {
    recursive: true,
    verbatimSymlinks: true,
    filter: (source) => path.resolve(source) !== browsers,
  });
}

/**
 * Why the trial home's WAF workspace cannot be used, or null. It must be the seed's own,
 * prepared there: a checkout outside the home would be shared by every trial, and a trial
 * never clones one itself.
 */
async function workspace(server: Server): Promise<string | null> {
  const { status } = await server.call<{
    status: { managed: boolean; ready: boolean; lastError: string | null };
  }>("GET", "/api/admin/waf-workspace");
  if (!status.managed)
    return "The seed names a WAF checkout outside it, which every trial would share: let Penguin prepare one in the seed instead.";
  if (!status.ready)
    return `The seed's WAF workspace is not prepared${status.lastError ? `: ${status.lastError}` : "."}`;
  return null;
}

/**
 * Points the trial home's Claude Code at the bench's own folder and asks the server whether it
 * can run from there. The bench never reads or copies a login; the server's own sign-in check
 * does, and only in the bench's folder (or an API key a person gave the seed's definition).
 */
async function useClaude(server: Server, layout: BenchLayout): Promise<true | string> {
  const { agents } = await server.call<{
    agents: { id: string; env?: { key: string }[] }[];
  }>("GET", "/api/coding-agents/agents");
  const definition = agents.find((agent) => agent.id === CLAUDE);
  if (!definition) return "The seed home has no Claude Code coding agent.";
  const kept = (definition.env ?? [])
    .filter((entry) => entry.key !== "CLAUDE_CONFIG_DIR")
    .map((entry) => ({ key: entry.key }));
  await server.call("PUT", `/api/coding-agents/agents/${CLAUDE}/env`, {
    entries: [...kept, { key: "CLAUDE_CONFIG_DIR", value: layout.claudeConfig }],
  });
  const { candidates } = await server.call<{
    candidates: { recipeId: string; detected: boolean; authStatus?: string }[];
  }>("GET", "/api/coding-agents/discover");
  const claude = candidates.find((candidate) => candidate.recipeId === CLAUDE);
  if (!claude?.detected) return "Claude Code is not installed on this machine.";
  if (claude.authStatus !== "ok")
    return `No Claude login in ${layout.claudeConfig}: sign in there once, or give the seed's Claude Code definition an ANTHROPIC_API_KEY.`;
  return true;
}

export class IsolatedServer implements AuthoringHost {
  private readonly layout: BenchLayout;
  private readonly log: (line: string) => void;

  constructor(private readonly options: IsolatedServerOptions) {
    this.layout = benchLayout(options.home);
    this.log = options.log ?? (() => {});
  }

  async preflight(shas: string[]): Promise<SeedCheck> {
    const { project, agentId } = this.options;
    for (const sha of new Set(shas)) {
      try {
        await this.recipe(sha);
      } catch (error) {
        return { refused: `Commit ${sha.slice(0, 12)} could not be prepared: ${message(error)}` };
      }
    }
    return seedPreflight({
      worktree: await this.recipe(shas[0]!),
      layout: this.layout,
      project,
      agentId,
    });
  }

  async author(trial: TrialPlan): Promise<AuthoredTrial> {
    const dir = this.folder(trial);
    fs.rmSync(dir, { recursive: true, force: true });
    copySeed(this.layout, dir);
    const started = Date.now();
    const server = await this.boot(trial.sha, dir);
    try {
      const { project, agentId } = this.options;
      const problem = await workspace(server);
      if (problem) throw new InfrastructureError(problem);
      if (trial.runtime === "coding:claude") {
        const ready = await useClaude(server, this.layout);
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
    // The install runs install scripts: dependencies the Stages use need theirs (ffmpeg-static,
    // sharp, node-pty, onnxruntime-node), so `--ignore-scripts` would break the build. A
    // candidate cannot add one: outside the plugin's skills every file, the plugin's manifests
    // but for their version, is the same on both sides (surface.ts).
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
    return bootTrial(await this.recipe(sha), this.layout, dir);
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
