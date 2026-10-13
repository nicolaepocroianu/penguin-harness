/**
 * The activity bench's shapes: what a comparison answers (Verdict), what a case is, and the two
 * seams a comparison runs through — the AuthoringHost that takes a case through the Stages, and
 * the CaseVault that holds the cases and their hidden checks.
 */

/** Which part of the case set a case belongs to: scored per case, or only in aggregate. */
export type Split = "dev" | "heldOut";

/** Which side of a comparison a trial belongs to. */
export type Side = "base" | "head";

/**
 * Who answers in a trial: the Project's default model for activity_agent, or Claude Code as the
 * non-regression check (decision 8).
 */
export type Runtime = "default" | "coding:claude";

export type InvalidReason =
  | "dirty_tree"
  | "out_of_surface"
  | "preflight"
  | "budget"
  | "infrastructure"
  | "bench_changed"
  | "contaminated"
  | "busy";

/** What decided how a side's agent worked: the commit, the agent, and who answered. */
export interface RecipeId {
  sha: string;
  /** The Penguin agent the Stages ran as. */
  testAgent: string;
  runtime: Runtime;
  /** What answered, as the ledger names it (`agent:<provider>/<model>`); null until known. */
  answeredBy: string | null;
  /** The agent's thinking level in the seed; null when it does not say. */
  thinking: string | null;
}

/** One dev case's public result. */
export interface CaseResult {
  case: string;
  title: string;
  base: number;
  head: number;
  delta: number;
  trials: number;
}

export type Interval = [number, number];

export type NonRegression =
  | { runtime: "coding:claude"; delta: number; ci90: Interval }
  | { runtime: "coding:claude"; skipped: string };

export type Guardrail = "selfGradingGap" | "costPerTrial";

/** The answer to "is head better than base?". */
export interface Verdict {
  decision: "better" | "inconclusive" | "worse" | "invalid";
  invalid?: InvalidReason;
  /** What made it invalid, in a sentence. */
  reason?: string;
  /** The evaluation's id: running the same comparison again resumes it. */
  evaluation: string | null;
  head: RecipeId;
  base: RecipeId;
  /** Score points (0–100), head minus base, over the dev cases; public signals only. */
  dev: { delta: number; ci90: Interval; cases: CaseResult[] };
  /** The held-out cases, in aggregate only. */
  heldOut: { delta: number; ci90: Interval };
  /** [base, head] for each guardrail, and the ones head made worse. */
  guardrails: {
    /** Share of criteria the run's own tests pass while the hidden checks fail. */
    selfGradingGap: [number, number];
    costPerTrial: [number | null, number | null];
    worse: Guardrail[];
  };
  /** Claude Code on the dev cases, when the bench-owned login is there. */
  nonRegression: NonRegression;
  /** Trials whose own report said something other than their tests did when re-run. */
  selfReportMismatches: { base: number; head: number };
  /** Spread of one trial's score around its case's mean, in points. */
  noiseSd: number;
  /** The smallest dev rise that counts: max(2 points, 2 × paired standard error). */
  minDetectable: number;
  costUsd: { head: number; base: number; spent: number };
  /** Scoreboard versions this comparison recorded. */
  recorded: number[];
}

/** One frozen request: a script and whatever an author would hand over with it. */
export interface CaseRequest {
  title: string;
  productCode: string;
  refNum: number;
  activityType?: "standard" | "book";
  bookMode?: "readAlong" | "decodable";
  /** The activity script. */
  script: string;
  /** A frozen specification, applied before the Stages run. */
  spec?: unknown;
  /** A media manifest with every asset already bound (decision 14). */
  media?: unknown;
  /**
   * The Stages sequences to run, in order: `["all"]` for a case that starts from its script,
   * `["module", "test"]` for one that starts from a frozen specification and bound media.
   */
  sequences: string[];
}

/** What a case says about itself before anything is unsealed. */
export interface CaseSummary {
  id: string;
  split: Split;
  weight: number;
  title: string;
  /** Not a real case: a stand-in until the frozen cases arrive (decision 9). */
  placeholder: boolean;
}

/** A case's checks, which only the evaluator holds and runs. */
export interface HiddenChecks {
  /** An ES module written against the acceptance harness, as `acceptance.test.mjs` is. */
  test: string;
  criteria: string[];
  scenes: string[];
  viewport: { width: number; height: number };
}

export interface CaseSet {
  bench: string;
  /** Changes whenever any case, request or hidden check changes. */
  revision: string;
  cases: CaseSummary[];
}

/** Where the cases are kept. */
export interface CaseVault {
  /** A sealed vault is fit to score a recipe; a plain one only to try the bench. */
  readonly sealed: boolean;
  describe(): Promise<CaseSet>;
  request(caseId: string): Promise<CaseRequest>;
  /** Unseals one case's hidden checks into memory: call only once no graded process runs. */
  hidden(caseId: string): Promise<HiddenChecks>;
  /** What no graded Trace may contain: the canary, and where the cases are kept. */
  tripwires(): string[];
}

/** One case taken through its Stages once, for one score, on one side. */
export interface TrialPlan {
  /** Stable across resumes: `<runtime>/<case>/<trial>/<side>`. */
  id: string;
  side: Side;
  sha: string;
  runtime: Runtime;
  caseId: string;
  split: Split;
  /** Which of the case's trials this is, from 0. */
  trial: number;
  request: CaseRequest;
}

/** What the host reports once a trial's Stages ended and every process it started is gone. */
export interface AuthoredTrial {
  /** How the last sequence ended; `timed_out` when the host stopped it. */
  pipeline: "succeeded" | "failed" | "cancelled" | "timed_out";
  costUsd: number | null;
  durationMs: number;
  /** The Sessions the trial's runs worked in, oldest first. */
  sessionIds: string[];
  answeredBy: string | null;
  thinking: string | null;
  /** The trial's own test report, by criterion; null when its tests never reported. */
  selfReport: { criterion: string; status: string }[] | null;
}

/** A trial's module, served again for scoring. */
export interface PlaySession {
  playUrl: string;
  /** The tests the trial's own test run wrote, to re-run with the frozen harness. */
  ownTests: HiddenChecks | null;
  close(): Promise<void>;
}

/** Thrown for a fault of the machinery, not of the recipe: retried once, never scored zero. */
export class InfrastructureError extends Error {}

/** Takes a case through the Stages for one recipe. */
export interface AuthoringHost {
  /**
   * Whether trials can run for these commits, before anything is spent: a refusal says why.
   * `claude` is true when Claude Code can run, or says why it cannot.
   */
  preflight(shas: string[]): Promise<{ refused: string } | { claude: true | string }>;
  /**
   * Runs the trial in a fresh home. When it resolves or throws, no process it started is
   * running. Throws InfrastructureError for a fault of the machinery.
   */
  author(trial: TrialPlan): Promise<AuthoredTrial>;
  /** Files and folders holding what the trial's graded agents wrote, to scan. */
  traces(trial: TrialPlan): Promise<string[]>;
  /** Serves the trial's module again; null when it made none. */
  play(trial: TrialPlan): Promise<PlaySession | null>;
  /** Removes the trial's home. */
  discard(trial: TrialPlan): Promise<void>;
}

/** What a check file found against a played module. */
export type CheckRun =
  | {
      ran: true;
      results: { criterion: string; testName: string; status: string; error: string | null }[];
    }
  | { ran: false; reason: string };

/** Runs a check file with the evaluator's frozen harness, in the evaluator's own browser. */
export interface CheckRunner {
  /** Identifies the harness, runner and browser it uses: a change means a new Benchmark. */
  readonly fingerprint: string;
  /**
   * `hidden`: the checks are a case's hidden ones, so when they cannot run, the reason says
   * only how they stopped — never what they printed.
   */
  run(checks: HiddenChecks, playUrl: string, options?: { hidden?: boolean }): Promise<CheckRun>;
}
