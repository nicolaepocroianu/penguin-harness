/**
 * The bench's records, in agent-tuning's Benchmark format unchanged (decision 13), so the
 * Evaluation Center reads them as it reads any Benchmark: `benchmark_config.toml`,
 * `scoreboard.yaml`, and per case `statement/README.md` and `rubric/README.md` — public parts
 * only. One Benchmark per case-set revision and scorer (`activity-bench-r<N>`); the bench's own
 * counter is each evaluation's `version`; the commit and the recipe go in its summary.
 *
 * Which recipes a Benchmark already holds is kept beside the Benchmarks, in the bench home's
 * `records.json`, never inside a Benchmark folder.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The same YAML library the server reads scoreboards with. */
const YAML = createRequire(path.resolve(HERE, "../../packages/server/package.json"))("yaml") as {
  parse(text: string): unknown;
  stringify(value: unknown, options?: { lineWidth?: number }): string;
};

export interface BenchmarkCase {
  id: string;
  title: string;
  statement: string;
  rubric: string;
}

export interface RecordedRun {
  score: number;
  cost: number | null;
  durationMs: number;
  sessionId: string;
}

export interface RecordedEvaluation {
  time: string;
  agentId: string;
  provider: string;
  modelId: string;
  thinkingLevel: string;
  summaryTitle: string;
  summary: string;
  cases: { case: string; runs: RecordedRun[] }[];
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Known costs averaged; null only when every one is unknown. */
function averageCost(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? Number(average(known).toFixed(6)) : null;
}

const toml = (value: string | number) =>
  typeof value === "number" ? String(value) : JSON.stringify(value);

/** Creates a Benchmark folder with its cases' public parts; leaves an existing one alone. */
export function ensureBenchmark(
  dir: string,
  benchmark: { title: string; description: string; runs: number; cases: BenchmarkCase[] },
): void {
  if (fs.existsSync(path.join(dir, "benchmark_config.toml"))) return;
  fs.mkdirSync(dir, { recursive: true });
  for (const item of benchmark.cases) {
    const caseDir = path.join(dir, item.id);
    fs.mkdirSync(path.join(caseDir, "statement"), { recursive: true });
    fs.mkdirSync(path.join(caseDir, "rubric"), { recursive: true });
    fs.writeFileSync(
      path.join(caseDir, "statement", "README.md"),
      `# ${item.title}\n\n${item.statement.trim()}\n`,
    );
    fs.writeFileSync(path.join(caseDir, "rubric", "README.md"), `${item.rubric.trim()}\n`);
  }
  fs.writeFileSync(path.join(dir, "scoreboard.yaml"), "evaluations: []\n");
  // Written last: it is what makes the folder a Benchmark.
  fs.writeFileSync(
    path.join(dir, "benchmark_config.toml"),
    [
      `title = ${toml(benchmark.title)}`,
      `description = ${toml(benchmark.description)}`,
      `runs = ${toml(benchmark.runs)}`,
      `status = "published"`,
      "",
    ].join("\n"),
  );
}

/** Appends one evaluation with its averages worked out as agent-tuning writes them. */
export function appendEvaluation(dir: string, version: number, entry: RecordedEvaluation): void {
  const file = path.join(dir, "scoreboard.yaml");
  const board = (YAML.parse(fs.readFileSync(file, "utf8")) ?? {}) as { evaluations?: unknown[] };
  const cases = entry.cases.map((item) => ({
    case: item.case,
    score: Number(average(item.runs.map((run) => run.score)).toFixed(2)),
    cost: averageCost(item.runs.map((run) => run.cost)),
    duration_ms: Math.round(average(item.runs.map((run) => run.durationMs))),
    runs: item.runs.map((run) => ({
      score: Number(run.score.toFixed(2)),
      cost: run.cost,
      duration_ms: Math.round(run.durationMs),
      session_id: run.sessionId,
    })),
  }));
  const evaluation = {
    time: entry.time,
    agent_id: entry.agentId,
    version,
    provider: entry.provider,
    model_id: entry.modelId,
    thinking_level: entry.thinkingLevel,
    summary_title: entry.summaryTitle,
    summary: entry.summary,
    score: Number(average(cases.map((item) => item.score)).toFixed(2)),
    cost: averageCost(cases.map((item) => item.cost)),
    duration_ms: Math.round(average(cases.map((item) => item.duration_ms))),
    cases,
  };
  const evaluations = Array.isArray(board.evaluations) ? board.evaluations : [];
  const next = { ...board, evaluations: [...evaluations, evaluation] };
  fs.writeFileSync(`${file}.tmp`, YAML.stringify(next, { lineWidth: 0 }));
  fs.renameSync(`${file}.tmp`, file);
}

interface Records {
  /** Benchmark number by case-set revision and scorer. */
  benchmarks: Record<string, number>;
  /** By Benchmark id: the version each recorded recipe fingerprint got. */
  recorded: Record<string, Record<string, number>>;
}

/** What the bench home remembers about the Benchmarks it wrote. */
export class BenchRecords {
  private readonly file: string;

  constructor(home: string) {
    this.file = path.join(home, "records.json");
  }

  private read(): Records {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8")) as Records;
    } catch {
      return { benchmarks: {}, recorded: {} };
    }
  }

  private write(records: Records): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(`${this.file}.tmp`, `${JSON.stringify(records, null, 2)}\n`);
    fs.renameSync(`${this.file}.tmp`, this.file);
  }

  /** The Benchmark id for a case-set revision and scorer: a new one for a new pair. */
  benchmarkId(key: string): string {
    const records = this.read();
    let number = records.benchmarks[key];
    if (number === undefined) {
      number = Math.max(0, ...Object.values(records.benchmarks)) + 1;
      records.benchmarks[key] = number;
      this.write(records);
    }
    return `activity-bench-r${number}`;
  }

  /** The version a recipe was recorded with on a Benchmark, or null. */
  versionOf(benchmark: string, fingerprint: string): number | null {
    return this.read().recorded[benchmark]?.[fingerprint] ?? null;
  }

  /** Whether the Benchmark holds any recipe yet: the first one is its Formal Baseline. */
  isEmpty(benchmark: string): boolean {
    return !Object.keys(this.read().recorded[benchmark] ?? {}).length;
  }

  /** Takes the next version for a recipe; the caller writes it to the scoreboard. */
  claim(benchmark: string, fingerprint: string): number {
    const records = this.read();
    const recorded = (records.recorded[benchmark] ??= {});
    const version = Math.max(0, ...Object.values(recorded)) + 1;
    recorded[fingerprint] = version;
    this.write(records);
    return version;
  }
}
