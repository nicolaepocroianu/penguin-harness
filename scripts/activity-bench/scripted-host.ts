/**
 * An AuthoringHost that follows a script instead of running the Stages: what each trial cost,
 * what its graded agent wrote, whether it made a module, and which faults it hits. The bench's
 * own tests run every rule through it without a server, a model or a cent.
 */
import fs from "node:fs";
import path from "node:path";
import {
  InfrastructureError,
  type AuthoredTrial,
  type AuthoringHost,
  type HiddenChecks,
  type PlaySession,
  type TrialPlan,
} from "./types.js";

/** What one trial does, by the script. */
export interface ScriptedTrial {
  pipeline?: AuthoredTrial["pipeline"];
  costUsd?: number | null;
  durationMs?: number;
  /** Fails with a machinery fault this many times before it runs. */
  infraFaults?: number;
  /** What its graded agent wrote into its Traces. */
  trace?: string;
  /** Whether it made a module to play; true by default. */
  module?: boolean;
  ownTests?: HiddenChecks | null;
  selfReport?: AuthoredTrial["selfReport"];
  answeredBy?: string | null;
}

export class ScriptedHost implements AuthoringHost {
  /** Trial ids in the order they were authored, each attempt once. */
  readonly authored: string[] = [];
  readonly discarded: string[] = [];
  private readonly attempts = new Map<string, number>();

  constructor(
    private readonly dir: string,
    private readonly script: (trial: TrialPlan) => ScriptedTrial,
    private readonly setup: { refused?: string; claude?: true | string } = {},
  ) {}

  async preflight(): Promise<{ refused: string } | { claude: true | string }> {
    if (this.setup.refused) return { refused: this.setup.refused };
    return { claude: this.setup.claude ?? "Claude Code is not set up for this bench." };
  }

  async author(trial: TrialPlan): Promise<AuthoredTrial> {
    const attempt = this.attempts.get(trial.id) ?? 0;
    this.attempts.set(trial.id, attempt + 1);
    this.authored.push(trial.id);
    const scripted = this.script(trial);
    if (attempt < (scripted.infraFaults ?? 0))
      throw new InfrastructureError(`Scripted fault ${attempt + 1} of ${trial.id}.`);
    const folder = this.folder(trial);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "trace.jsonl"), scripted.trace ?? "{}\n");
    return {
      pipeline: scripted.pipeline ?? "succeeded",
      costUsd: scripted.costUsd === undefined ? 1 : scripted.costUsd,
      durationMs: scripted.durationMs ?? 60_000,
      sessionIds: [`ses_${trial.id.replace(/\W/g, "_")}`],
      answeredBy: scripted.answeredBy === undefined ? "agent:scripted/model" : scripted.answeredBy,
      thinking: "medium",
      selfReport: scripted.selfReport ?? null,
    };
  }

  async traces(trial: TrialPlan): Promise<string[]> {
    return [this.folder(trial)];
  }

  async play(trial: TrialPlan): Promise<PlaySession | null> {
    const scripted = this.script(trial);
    if (scripted.module === false) return null;
    return {
      playUrl: `scripted://${trial.id}`,
      ownTests: scripted.ownTests ?? null,
      close: async () => {},
    };
  }

  async discard(trial: TrialPlan): Promise<void> {
    this.discarded.push(trial.id);
    fs.rmSync(this.folder(trial), { recursive: true, force: true });
  }

  private folder(trial: TrialPlan): string {
    return path.join(this.dir, ...trial.id.split("/"));
  }
}
