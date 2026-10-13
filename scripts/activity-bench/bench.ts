/**
 * The activity bench: one question — is head's recipe better than base's? — answered with a
 * Verdict, under every rule that keeps the answer honest.
 *
 * Before anything is spent: both sides are commits, the checkout grading them is clean, and
 * head changes nothing outside the recipe surface; the host says it can run; the estimate fits
 * the cap. Then base and head take every case through the Stages in interleaved blocks, so
 * provider drift falls on both alike. After each block — every graded process stopped by the
 * host — the graded Traces are scanned for the vault's tripwires; only then are the block's
 * hidden checks unsealed, into memory, and run by the evaluator with its own frozen harness.
 * A trial's own tests are re-run the same way, before any hidden check is unsealed, for the
 * self-grading gap. Progress is saved after every trial, so the same comparison resumes; a
 * machinery fault is retried once and never scored zero.
 *
 * Records (agent-tuning's scoreboard): base once per recipe fingerprint — the first is the
 * Benchmark's Formal Baseline — and head only when it is better.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { passedCriteria } from "./checks.js";
import { BenchRecords, appendEvaluation, ensureBenchmark, type RecordedRun } from "./scoreboard.js";
import {
  decide,
  mean,
  minDetectable,
  noiseSd,
  pairedBootstrap,
  round,
  worsened,
  type PairedCase,
} from "./stats.js";
import { commitOf, git, isDirty, mergeBase, outsideSurface, recipeFingerprint } from "./surface.js";
import {
  InfrastructureError,
  type AuthoredTrial,
  type AuthoringHost,
  type CaseSet,
  type CaseSummary,
  type CaseVault,
  type CheckRunner,
  type Guardrail,
  type InvalidReason,
  type NonRegression,
  type RecipeId,
  type Runtime,
  type Side,
  type TrialPlan,
  type Verdict,
} from "./types.js";

/** Raised when the scoring rules change: a new Benchmark, so a new Formal Baseline. */
export const SCORING_VERSION = 1;
export const DEFAULT_TRIALS = 3;
/** Decision 11: the cap per evaluation until the A/A run measures real cost. */
export const DEFAULT_MAX_COST_USD = 150;
export const DEFAULT_AGENT = "activity_agent";

export interface CompareRequest {
  /** The candidate: HEAD by default. */
  head?: string;
  /** What it is compared with: its merge base with the main line by default. */
  base?: string;
  trials?: number;
  maxCostUsd?: number;
}

export interface ActivityBench {
  compare(request?: CompareRequest): Promise<Verdict>;
}

export interface BenchOptions {
  /** The evaluator's checkout: head and base are its commits, and it must be clean. */
  repo: string;
  /** The bench home: evaluations, records and Benchmarks are kept here. */
  home: string;
  /** The Project the Benchmarks are filed under. */
  project: string;
  host: AuthoringHost;
  vault: CaseVault;
  checks: CheckRunner;
  /** Whether to write the scoreboard: only for a sealed vault. */
  record: boolean;
  /** What one trial is expected to cost, until trials have measured it. */
  trialEstimateUsd: number;
  agentId?: string;
  /** The main line base defaults against. */
  mainRef?: string;
  /** Whether to run the Claude Code non-regression check when it can run. */
  claude?: boolean;
  /** Asked once, with the estimate, before the first trial is paid for; false stops there. */
  confirm?: (estimateUsd: number) => Promise<boolean>;
  log?: (line: string) => void;
  now?: () => Date;
}

/** One scored trial, as the evaluation keeps it. */
interface TrialRecord {
  side: Side;
  runtime: Runtime;
  caseId: string;
  split: CaseSummary["split"];
  trial: number;
  /** Hidden checks passed, out of 100. */
  score: number;
  /** Share of criteria its own tests pass while the hidden checks fail; null when unknown. */
  gap: number | null;
  /** Its own report said something its tests, re-run, did not. */
  mismatch: boolean;
  costUsd: number | null;
  durationMs: number;
  sessionId: string;
  answeredBy: string | null;
  thinking: string | null;
}

interface EvaluationState {
  version: 1;
  id: string;
  head: string;
  base: string;
  trials: number;
  benchKey: string;
  runtimes: Runtime[];
  claudeSkipped: string | null;
  spentUsd: number;
  /** Authored and paid for, by trial id; kept until scored. */
  authored: Record<string, AuthoredTrial>;
  scored: Record<string, TrialRecord>;
  /** Set when the evaluation was voided for good. */
  void?: { invalid: InvalidReason; reason: string };
  verdict?: Verdict;
}

interface Block {
  runtime: Runtime;
  summary: CaseSummary;
  trial: number;
  order: Side[];
}

function blankRecipe(sha: string, runtime: Runtime, agentId: string): RecipeId {
  return { sha, testAgent: agentId, runtime, answeredBy: null, thinking: null };
}

function invalidVerdict(
  invalid: InvalidReason,
  reason: string,
  head: RecipeId,
  base: RecipeId,
  evaluation: string | null = null,
  spent = 0,
): Verdict {
  return {
    decision: "invalid",
    invalid,
    reason,
    evaluation,
    head,
    base,
    dev: { delta: 0, ci90: [0, 0], cases: [] },
    heldOut: { delta: 0, ci90: [0, 0] },
    guardrails: { selfGradingGap: [0, 0], costPerTrial: [null, null], worse: [] },
    nonRegression: { runtime: "coding:claude", skipped: "The evaluation did not run." },
    selfReportMismatches: { base: 0, head: 0 },
    noiseSd: 0,
    minDetectable: 0,
    costUsd: { head: 0, base: 0, spent: round(spent) },
    recorded: [],
  };
}

/** How a recorded evaluation is titled on the scoreboard. */
function titleOf(formal: boolean, side: Side, sha: string, other: string): string {
  if (formal) return `Formal baseline at ${sha.slice(0, 12)}`;
  if (side === "head") return `Better: ${sha.slice(0, 12)} over ${other.slice(0, 12)}`;
  return `Base ${sha.slice(0, 12)}`;
}

/** Stops the evaluation with an invalid verdict. */
class Stop extends Error {
  constructor(
    readonly invalid: InvalidReason,
    reason: string,
  ) {
    super(reason);
  }
}

/** Another evaluation holds the bench home: one runs at a time. */
function acquireLock(home: string): (() => void) | null {
  const file = path.join(home, "bench.lock");
  fs.mkdirSync(home, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, `${process.pid}\n`, { flag: "wx" });
      return () => fs.rmSync(file, { force: true });
    } catch {
      const holder = Number(fs.readFileSync(file, "utf8").trim());
      if (Number.isInteger(holder) && holder > 0 && isAlive(holder)) return null;
      fs.rmSync(file, { force: true });
    }
  }
  return null;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

const SKIPPED_DIRS = new Set(["node_modules", ".git", "browsers"]);
const SCAN_MAX_BYTES = 64 * 1024 * 1024;

/** The first file under `roots` holding any tripwire, in any of the ways a Trace writes it. */
export function scanForTripwires(
  roots: readonly string[],
  tripwires: readonly string[],
): string | null {
  const needles = new Set<string>();
  for (const wire of tripwires) {
    const lower = wire.toLowerCase();
    needles.add(lower);
    needles.add(lower.replaceAll("\\", "/"));
    needles.add(lower.replaceAll("\\", "\\\\"));
    needles.add(lower.replaceAll("/", "\\"));
  }
  const visit = (at: string): string | null => {
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(at);
    } catch {
      return null;
    }
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(at)) {
        if (SKIPPED_DIRS.has(entry)) continue;
        const hit = visit(path.join(at, entry));
        if (hit) return hit;
      }
      return null;
    }
    if (!stat.isFile() || stat.size > SCAN_MAX_BYTES) return null;
    const text = fs.readFileSync(at, "latin1").toLowerCase();
    for (const needle of needles) if (text.includes(needle)) return at;
    return null;
  };
  for (const root of roots) {
    const hit = visit(root);
    if (hit) return hit;
  }
  return null;
}

export function createActivityBench(options: BenchOptions): ActivityBench {
  const agentId = options.agentId ?? DEFAULT_AGENT;
  const log = options.log ?? (() => {});
  const now = options.now ?? (() => new Date());
  const { repo, home, host, vault, checks } = options;

  async function compare(request: CompareRequest = {}): Promise<Verdict> {
    const trials = request.trials ?? DEFAULT_TRIALS;
    const cap = request.maxCostUsd ?? DEFAULT_MAX_COST_USD;
    const headSha = await commitOf(repo, request.head ?? "HEAD");
    const baseSha = request.base
      ? await commitOf(repo, request.base)
      : headSha && (await mergeBase(repo, headSha, options.mainRef ?? "origin/main"));
    const head = blankRecipe(headSha ?? "", "default", agentId);
    const base = blankRecipe(baseSha ?? "", "default", agentId);
    if (!headSha)
      return invalidVerdict("preflight", `${request.head ?? "HEAD"} names no commit.`, head, base);
    if (!baseSha)
      return invalidVerdict(
        "preflight",
        request.base
          ? `${request.base} names no commit.`
          : "head has no merge base with the main line.",
        head,
        base,
      );
    if (await isDirty(repo))
      return invalidVerdict(
        "dirty_tree",
        "The checkout has changes that are not committed: the bench compares commits, and grades with this checkout.",
        head,
        base,
      );
    const outside = await outsideSurface(repo, baseSha, headSha);
    if (outside.length)
      return invalidVerdict(
        "out_of_surface",
        `head changes files outside the recipe surface: ${outside.slice(0, 5).join(", ")}${outside.length > 5 ? ` and ${outside.length - 5} more` : ""}.`,
        head,
        base,
      );
    const release = acquireLock(home);
    if (!release)
      return invalidVerdict(
        "busy",
        "Another evaluation is running in this bench home.",
        head,
        base,
      );
    try {
      return await evaluate(headSha, baseSha, trials, cap);
    } finally {
      release();
    }
  }

  async function evaluate(
    headSha: string,
    baseSha: string,
    trials: number,
    cap: number,
  ): Promise<Verdict> {
    const set = await vault.describe();
    const evaluator = (await git(repo, ["rev-parse", "HEAD"])).trim();
    const benchKey = `${set.bench}:${set.revision}:${checks.fingerprint}:${SCORING_VERSION}`;
    const id = createHash("sha256")
      .update(JSON.stringify({ headSha, baseSha, trials, benchKey, evaluator, agentId }))
      .digest("hex")
      .slice(0, 16);
    const dir = path.join(home, "evaluations", id);
    const stateFile = path.join(dir, "state.json");
    let state: EvaluationState | null = null;
    try {
      state = JSON.parse(fs.readFileSync(stateFile, "utf8")) as EvaluationState;
    } catch {
      state = null;
    }
    const fail = (invalid: InvalidReason, reason: string, current: EvaluationState | null) =>
      invalidVerdict(
        invalid,
        reason,
        blankRecipe(headSha, "default", agentId),
        blankRecipe(baseSha, "default", agentId),
        id,
        current?.spentUsd ?? 0,
      );
    if (state?.void) return fail(state.void.invalid, state.void.reason, state);
    if (state?.verdict) return state.verdict;
    if (state && state.benchKey !== benchKey)
      return fail(
        "bench_changed",
        "The cases or the scorer changed since this evaluation began.",
        state,
      );

    const ready = await host.preflight([baseSha, headSha]);
    if ("refused" in ready) return fail("preflight", ready.refused, state);
    if (!state) {
      let claudeSkipped: string | null = null;
      if (options.claude === false) claudeSkipped = "Turned off for this evaluation.";
      else if (ready.claude !== true) claudeSkipped = ready.claude;
      state = {
        version: 1,
        id,
        head: headSha,
        base: baseSha,
        trials,
        benchKey,
        runtimes: claudeSkipped === null ? ["default", "coding:claude"] : ["default"],
        claudeSkipped,
        spentUsd: 0,
        authored: {},
        scored: {},
      };
    } else if (state.runtimes.includes("coding:claude") && ready.claude !== true) {
      return fail(
        "preflight",
        `This evaluation runs Claude Code, which cannot run now: ${ready.claude}`,
        state,
      );
    }
    const current = state;
    const save = () => {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(`${stateFile}.tmp`, `${JSON.stringify(current, null, 2)}\n`);
      fs.renameSync(`${stateFile}.tmp`, stateFile);
    };
    save();

    // The blocks: every case, trial by trial, Claude Code on the dev cases; sides alternate.
    const blocks: Block[] = [];
    for (let trial = 0; trial < trials; trial++)
      for (const summary of set.cases)
        for (const runtime of current.runtimes) {
          if (runtime === "coding:claude" && summary.split !== "dev") continue;
          blocks.push({
            runtime,
            summary,
            trial,
            order: blocks.length % 2 === 0 ? ["base", "head"] : ["head", "base"],
          });
        }
    const plan = (block: Block, side: Side, request: TrialPlan["request"]): TrialPlan => ({
      id: `${id}/${block.runtime === "default" ? "default" : "claude"}/${block.summary.id}/${block.trial}/${side}`,
      side,
      sha: side === "head" ? headSha : baseSha,
      runtime: block.runtime,
      caseId: block.summary.id,
      split: block.summary.split,
      trial: block.trial,
      request,
    });
    const unpaid =
      blocks.length * 2 - Object.keys(current.authored).length - Object.keys(current.scored).length;
    const estimate = round(current.spentUsd + unpaid * options.trialEstimateUsd);
    log(
      `${blocks.length * 2} trials (${set.cases.length} cases × ${trials} × base and head${current.runtimes.length > 1 ? ", Claude Code on the dev cases" : ""}); estimated $${estimate} of a $${cap} cap.`,
    );
    if (estimate > cap)
      return fail(
        "budget",
        `The estimate, $${estimate}, is over the $${cap} cap: run fewer trials or raise --max-cost.`,
        current,
      );
    if (unpaid > 0 && options.confirm && !(await options.confirm(estimate)))
      return fail("budget", "Stopped before spending: the estimate was not confirmed.", current);

    const begun = new Map<string, TrialPlan>();
    try {
      for (const block of blocks) {
        const request = await vault.request(block.summary.id);
        const pending = block.order
          .map((side) => plan(block, side, request))
          .filter((trial) => !current.scored[trial.id]);
        if (!pending.length) continue;
        for (const trial of pending) begun.set(trial.id, trial);
        await checkUnchanged(set, evaluator);
        const unpaidHere = pending.filter((trial) => !current.authored[trial.id]);
        const known = Object.values(current.scored)
          .map((record) => record.costUsd)
          .filter((cost): cost is number => cost !== null);
        const perTrial = Math.max(options.trialEstimateUsd, known.length ? mean(known) : 0);
        if (current.spentUsd + unpaidHere.length * perTrial > cap)
          throw new Stop(
            "budget",
            `The next block would pass the $${cap} cap; $${round(current.spentUsd)} spent.`,
          );
        for (const trial of unpaidHere) {
          log(`Authoring ${trial.id}.`);
          const authored = await retried(() => host.author(trial));
          current.authored[trial.id] = authored;
          current.spentUsd += authored.costUsd ?? options.trialEstimateUsd;
          save();
        }
        // Every graded process of the block is stopped: scan what its agents wrote.
        const tripwires = vault.tripwires();
        for (const trial of pending) {
          const hit = scanForTripwires(await host.traces(trial), tripwires);
          if (hit) {
            current.void = {
              invalid: "contaminated",
              reason: `A graded Trace holds what only the evaluator may: ${hit}`,
            };
            save();
            throw new Stop("contaminated", current.void.reason);
          }
        }
        for (const trial of pending) {
          log(`Scoring ${trial.id}.`);
          const record = await retried(() => score(trial, current.authored[trial.id]!));
          current.scored[trial.id] = record;
          delete current.authored[trial.id];
          save();
          if (trial.split === "heldOut") await host.discard(trial);
        }
      }
    } catch (error) {
      // Whatever stopped it, a held-out script never outlives its trial unscored: the home
      // goes — however far its authoring got — and a resumed evaluation runs the trial again.
      for (const trial of begun.values()) {
        if (trial.split !== "heldOut" || current.scored[trial.id]) continue;
        try {
          await host.discard(trial);
          delete current.authored[trial.id];
        } catch {
          // Kept on the record, so the next run still knows the home is there.
        }
      }
      save();
      if (error instanceof Stop) return fail(error.invalid, error.message, current);
      throw error;
    }

    const verdict = summarise(current, set, headSha, baseSha);
    verdict.recorded =
      options.record && verdict.decision !== "invalid"
        ? await record(verdict, current, set, trials)
        : [];
    current.verdict = verdict;
    save();
    return verdict;
  }

  /** The cases, and the checkout grading them, are what the evaluation began with. */
  async function checkUnchanged(set: CaseSet, evaluator: string): Promise<void> {
    const now = await vault.describe();
    const head = (await git(repo, ["rev-parse", "HEAD"])).trim();
    if (now.revision !== set.revision || head !== evaluator || (await isDirty(repo)))
      throw new Stop(
        "bench_changed",
        "The cases or the grading checkout changed during the evaluation.",
      );
  }

  /** Runs a step, once more after a machinery fault; a second fault stops the evaluation. */
  async function retried<T>(step: () => Promise<T>): Promise<T> {
    try {
      return await step();
    } catch (error) {
      if (!(error instanceof InfrastructureError)) throw error;
      log(`A machinery fault, retrying once: ${error.message}`);
      try {
        return await step();
      } catch (again) {
        if (again instanceof InfrastructureError) throw new Stop("infrastructure", again.message);
        throw again;
      }
    }
  }

  /** Plays the trial's module again and scores it: its own tests first, then the hidden checks. */
  async function score(trial: TrialPlan, authored: AuthoredTrial): Promise<TrialRecord> {
    const session = await host.play(trial);
    try {
      // Before anything is unsealed: the trial's own tests are its agent's code.
      const own = session?.ownTests ? await checks.run(session.ownTests, session.playUrl) : null;
      const hidden = await vault.hidden(trial.caseId);
      const found = session ? await checks.run(hidden, session.playUrl, { hidden: true }) : null;
      // Not even the runner's own account of why: nothing of a hidden run is logged or kept.
      if (found && !found.ran)
        throw new InfrastructureError(`The hidden checks of ${trial.id} could not run.`);
      const passed = found ? passedCriteria(hidden.criteria, found) : new Set<string>();
      const total = hidden.criteria.length;
      let gap: number | null = session?.ownTests ? null : 0;
      let mismatch = false;
      if (own?.ran && session?.ownTests) {
        const ownPassed = passedCriteria(session.ownTests.criteria, own);
        const aligned = hidden.criteria.every((criterion) =>
          session.ownTests!.criteria.includes(criterion),
        );
        gap = aligned
          ? hidden.criteria.filter((c) => ownPassed.has(c) && !passed.has(c)).length /
            Math.max(1, total)
          : Math.max(
              0,
              ownPassed.size / Math.max(1, session.ownTests.criteria.length) -
                passed.size / Math.max(1, total),
            );
        mismatch =
          authored.selfReport !== null &&
          authored.selfReport.some(
            (entry) => (entry.status === "passed") !== ownPassed.has(entry.criterion),
          );
      }
      return {
        side: trial.side,
        runtime: trial.runtime,
        caseId: trial.caseId,
        split: trial.split,
        trial: trial.trial,
        score: round((100 * passed.size) / Math.max(1, total)),
        gap: gap === null ? null : round(gap, 4),
        mismatch,
        costUsd: authored.costUsd,
        durationMs: authored.durationMs,
        sessionId: authored.sessionIds[0] ?? `trial:${trial.id}`,
        answeredBy: authored.answeredBy,
        thinking: authored.thinking,
      };
    } finally {
      await session?.close();
    }
  }

  function summarise(
    state: EvaluationState,
    set: CaseSet,
    headSha: string,
    baseSha: string,
  ): Verdict {
    const records = Object.values(state.scored);
    const of = (runtime: Runtime, caseId: string, side: Side) =>
      records
        .filter((r) => r.runtime === runtime && r.caseId === caseId && r.side === side)
        .sort((a, b) => a.trial - b.trial);
    const paired = (
      runtime: Runtime,
      split: CaseSummary["split"],
      value: (r: TrialRecord) => number | null,
    ) =>
      set.cases
        .filter((item) => item.split === split)
        .map((item): PairedCase => {
          const heads = of(runtime, item.id, "head");
          const bases = of(runtime, item.id, "base");
          const diffs: number[] = [];
          for (const h of heads) {
            const b = bases.find((r) => r.trial === h.trial);
            const hv = value(h);
            const bv = b ? value(b) : null;
            if (hv !== null && bv !== null) diffs.push(hv - bv);
          }
          return { weight: item.weight, diffs };
        });
    const scoreOf = (r: TrialRecord) => r.score;
    const devCases = paired("default", "dev", scoreOf);
    const dev = pairedBootstrap(devCases, `${state.id}:dev`);
    const heldOut = pairedBootstrap(paired("default", "heldOut", scoreOf), `${state.id}:heldOut`);
    const noise = noiseSd(
      set.cases.flatMap((item) =>
        (["base", "head"] as const).map((side) => of("default", item.id, side).map(scoreOf)),
      ),
    );
    const smallest = minDetectable(devCases, noise);
    const both = (value: (r: TrialRecord) => number | null) => [
      ...paired("default", "dev", value),
      ...paired("default", "heldOut", value),
    ];
    const sideMean = (side: Side, value: (r: TrialRecord) => number | null) => {
      const known = records
        .filter((r) => r.runtime === "default" && r.side === side)
        .map(value)
        .filter((v): v is number => v !== null);
      return known.length ? known : null;
    };
    const worse: Guardrail[] = [];
    if (
      worsened(
        both((r) => r.gap),
        `${state.id}:gap`,
      )
    )
      worse.push("selfGradingGap");
    if (
      worsened(
        both((r) => r.costUsd),
        `${state.id}:cost`,
      )
    )
      worse.push("costPerTrial");
    let nonRegression: NonRegression;
    if (state.runtimes.includes("coding:claude")) {
      const claude = pairedBootstrap(paired("coding:claude", "dev", scoreOf), `${state.id}:claude`);
      nonRegression = { runtime: "coding:claude", delta: claude.delta, ci90: claude.ci90 };
    } else {
      nonRegression = { runtime: "coding:claude", skipped: state.claudeSkipped ?? "Not run." };
    }
    const decision = decide({
      dev,
      heldOut,
      nonRegression: "ci90" in nonRegression ? nonRegression : null,
      minDetectable: smallest,
      worse,
    });
    const recipeOf = (sha: string, side: Side): RecipeId => {
      const first = records.find((r) => r.runtime === "default" && r.side === side && r.answeredBy);
      return {
        sha,
        testAgent: agentId,
        runtime: "default",
        answeredBy: first?.answeredBy ?? null,
        thinking: first?.thinking ?? null,
      };
    };
    const gapMean = (side: Side) => round(mean(sideMean(side, (r) => r.gap) ?? []), 4);
    const costMean = (side: Side) => {
      const known = sideMean(side, (r) => r.costUsd);
      return known ? round(mean(known), 4) : null;
    };
    const spent = (side: Side) =>
      round(records.filter((r) => r.side === side).reduce((sum, r) => sum + (r.costUsd ?? 0), 0));
    const caseMean = (caseId: string, side: Side) =>
      round(mean(of("default", caseId, side).map(scoreOf)));
    return {
      decision,
      evaluation: state.id,
      head: recipeOf(headSha, "head"),
      base: recipeOf(baseSha, "base"),
      dev: {
        ...dev,
        cases: set.cases
          .filter((item) => item.split === "dev")
          .map((item) => ({
            case: item.id,
            title: item.title,
            base: caseMean(item.id, "base"),
            head: caseMean(item.id, "head"),
            delta: round(caseMean(item.id, "head") - caseMean(item.id, "base")),
            trials: of("default", item.id, "head").length,
          })),
      },
      heldOut,
      guardrails: {
        selfGradingGap: [gapMean("base"), gapMean("head")],
        costPerTrial: [costMean("base"), costMean("head")],
        worse,
      },
      nonRegression,
      selfReportMismatches: {
        base: records.filter((r) => r.side === "base" && r.mismatch).length,
        head: records.filter((r) => r.side === "head" && r.mismatch).length,
      },
      noiseSd: noise,
      minDetectable: smallest,
      costUsd: { head: spent("head"), base: spent("base"), spent: round(state.spentUsd) },
      recorded: [],
    };
  }

  /** Writes base once per recipe fingerprint, and head when it is better. */
  async function record(
    verdict: Verdict,
    state: EvaluationState,
    set: CaseSet,
    trials: number,
  ): Promise<number[]> {
    const records = new BenchRecords(home);
    const benchmark = records.benchmarkId(state.benchKey);
    const dir = path.join(home, options.project, "benchmarks", benchmark);
    const dev = set.cases.filter((item) => item.split === "dev");
    const heldOut = set.cases.length - dev.length;
    const statements = await Promise.all(dev.map((item) => vault.request(item.id)));
    ensureBenchmark(dir, {
      title: `Activity bench ${benchmark.replace("activity-bench-", "")}`,
      description: `Activity authoring through the Stages, scored by hidden checks the evaluator holds (case set ${set.bench} at ${set.revision.slice(0, 12)}). Dev cases are scored here (${dev.length}); held-out cases (${heldOut}) are reported only in each comparison's verdict.`,
      runs: trials,
      cases: dev.map((item, i) => ({
        id: item.id,
        title: item.title,
        statement: [
          statements[i]!.script,
          statements[i]!.spec !== undefined
            ? "The case starts from a frozen specification and media that are already bound."
            : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
        rubric:
          "Scored by hidden checks only the evaluator holds and runs. A trial's score is the share of them that pass, out of 100; a case's score is the mean of its trials.",
      })),
    });
    const recorded: number[] = [];
    const write = async (side: Side, recipe: RecipeId, other: RecipeId) => {
      const fingerprint = `${await recipeFingerprint(repo, recipe.sha, recipe.runtime)}:${agentId}:${recipe.answeredBy ?? "unknown"}`;
      if (records.versionOf(benchmark, fingerprint) !== null) return;
      const formal = records.isEmpty(benchmark);
      const version = records.claim(benchmark, fingerprint);
      const [provider, model] = (recipe.answeredBy ?? "").replace(/^agent:/, "").split("/", 2);
      const runs = (caseId: string): RecordedRun[] =>
        Object.values(state.scored)
          .filter((r) => r.runtime === "default" && r.side === side && r.caseId === caseId)
          .sort((a, b) => a.trial - b.trial)
          .map((r) => ({
            score: r.score,
            cost: r.costUsd,
            durationMs: r.durationMs,
            sessionId: r.sessionId,
          }));
      appendEvaluation(dir, version, {
        time: now()
          .toISOString()
          .replace(/\.\d{3}Z$/, "Z"),
        agentId,
        provider: provider || "project-default",
        modelId: model || recipe.answeredBy || "unknown",
        thinkingLevel: recipe.thinking ?? "default",
        summaryTitle: titleOf(formal, side, recipe.sha, other.sha),
        summary: [
          `Commit ${recipe.sha}; recipe ${fingerprint}; answered by ${recipe.answeredBy ?? "the Project's default model"}.`,
          side === "head"
            ? `Dev ${verdict.dev.delta} points over ${other.sha.slice(0, 12)} (90% ${verdict.dev.ci90.join(" to ")}); held-out ${verdict.heldOut.delta} (90% ${verdict.heldOut.ci90.join(" to ")}).`
            : `Compared with ${other.sha.slice(0, 12)} in evaluation ${state.id}.`,
          `Noise SD ${verdict.noiseSd}; smallest rise that counts ${verdict.minDetectable}; ${trials} trials per case.`,
        ].join(" "),
        cases: dev.map((item) => ({ case: item.id, runs: runs(item.id) })),
      });
      recorded.push(version);
    };
    await write("base", verdict.base, verdict.head);
    if (verdict.decision === "better") await write("head", verdict.head, verdict.base);
    return recorded;
  }

  return { compare };
}
