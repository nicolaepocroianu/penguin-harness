/**
 * pnpm bench [head] [base] [--trials 3] [--max-cost <usd>] [--json] [--no-claude] [--yes]
 *            [--plain <placeholder cases>] [--home <bench home>]
 * pnpm bench seal <private source> --bench <id> [--out <sealed file>] [--home <bench home>]
 *
 * head is HEAD and base its merge base with origin/main unless named. Exit 0 better, 1
 * inconclusive or worse, 2 invalid, 64 usage. How to set a bench home up, and what each answer
 * means: .agents/skills/activity-bench/SKILL.md.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  DEFAULT_AGENT,
  DEFAULT_MAX_COST_USD,
  DEFAULT_TRIALS,
  createActivityBench,
} from "./bench.js";
import { HarnessCheckRunner, findChromium } from "./checks.js";
import { IsolatedServer, benchLayout } from "./isolated-server.js";
import { proveAndSeal } from "./seal.js";
import type { CaseVault, Verdict } from "./types.js";
import { PlainVault, SealedVault } from "./vault.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

class UsageError extends Error {}

/** What a bench home's bench.json says. */
interface BenchConfig {
  /** The seed's Project the trials run in, and the Benchmarks are filed under. */
  project: string;
  agent?: string;
  /** The sealed case file. */
  vault?: string;
  /** What one trial is expected to cost, until trials have measured it. */
  trialEstimateUsd?: number;
  mainRef?: string;
}

function within(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** The bench home: bench-owned, never Penguin's own data, a server's root or this checkout. */
function benchHome(flag: string | undefined): string {
  const home = path.resolve(
    flag ?? process.env.PENGUIN_BENCH_HOME ?? path.join(os.homedir(), ".penguin-bench"),
  );
  const refused = [
    path.join(os.homedir(), ".penguin"),
    ...(process.env.PENGUIN_HOME ? [process.env.PENGUIN_HOME] : []),
    REPO,
  ].find((root) => within(root, home) || within(home, root));
  if (refused)
    throw new UsageError(
      `The bench home ${home} overlaps ${refused}: give the bench a folder of its own.`,
    );
  return home;
}

function readConfig(home: string): BenchConfig {
  const file = path.join(home, "bench.json");
  let config: BenchConfig;
  try {
    config = JSON.parse(fs.readFileSync(file, "utf8")) as BenchConfig;
  } catch {
    throw new UsageError(`Write ${file} first: see .agents/skills/activity-bench/SKILL.md.`);
  }
  if (typeof config.project !== "string" || !config.project)
    throw new UsageError(`${file} must name the seed's project.`);
  return config;
}

/** Reads a line at the terminal without echoing it. */
async function askHidden(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY)
    throw new UsageError("The passphrase is typed at a terminal: run the bench in one.");
  process.stderr.write(prompt);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const done = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write("\n");
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          done();
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          done();
          reject(new UsageError("Cancelled."));
          return;
        }
        value = char === "\u007f" || char === "\b" ? value.slice(0, -1) : value + char;
      }
    };
    stdin.on("data", onData);
  });
}

async function askYes(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const prompt = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    return /^y(es)?$/i.test((await prompt.question(question)).trim());
  } finally {
    prompt.close();
  }
}

function number(
  value: string | undefined,
  name: string,
  fallback: number,
  integer = false,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || (integer && !Number.isInteger(parsed)))
    throw new UsageError(`--${name} takes a ${integer ? "whole " : ""}number above 0.`);
  return parsed;
}

async function evaluatorBrowser(home: string): Promise<string> {
  const browser =
    (await findChromium(path.join(benchLayout(home).seed, "browsers"))) ?? (await findChromium());
  if (!browser)
    throw new UsageError("No test browser to run the checks in: install it in the seed home.");
  return browser;
}

function describe(verdict: Verdict): string {
  const lines: string[] = [];
  const short = (sha: string) => sha.slice(0, 12) || "?";
  if (verdict.decision === "invalid") {
    lines.push(`Invalid (${verdict.invalid}): ${verdict.reason}`);
    if (verdict.costUsd.spent) lines.push(`Spent $${verdict.costUsd.spent}.`);
    return lines.join("\n");
  }
  const interval = (ci: [number, number]) => `90% ${ci[0]} to ${ci[1]}`;
  lines.push(
    `${verdict.decision.toUpperCase()}: ${short(verdict.head.sha)} against ${short(verdict.base.sha)}`,
  );
  lines.push(
    `Dev: ${verdict.dev.delta} points (${interval(verdict.dev.ci90)}); counts above ${verdict.minDetectable}.`,
  );
  for (const item of verdict.dev.cases)
    lines.push(`  ${item.case}: ${item.base} -> ${item.head} (${item.trials} trials)`);
  lines.push(`Held out: ${verdict.heldOut.delta} points (${interval(verdict.heldOut.ci90)}).`);
  const { selfGradingGap, costPerTrial, worse } = verdict.guardrails;
  lines.push(
    `Self-grading gap: ${selfGradingGap[0]} -> ${selfGradingGap[1]}; cost per trial: $${costPerTrial[0] ?? "?"} -> $${costPerTrial[1] ?? "?"}${worse.length ? `; worse: ${worse.join(", ")}` : ""}.`,
  );
  lines.push(
    "skipped" in verdict.nonRegression
      ? `Claude Code: not run. ${verdict.nonRegression.skipped}`
      : `Claude Code: ${verdict.nonRegression.delta} points (${interval(verdict.nonRegression.ci90)}).`,
  );
  if (verdict.selfReportMismatches.base || verdict.selfReportMismatches.head)
    lines.push(
      `Own reports that their re-run contradicts: base ${verdict.selfReportMismatches.base}, head ${verdict.selfReportMismatches.head}.`,
    );
  lines.push(`Noise SD ${verdict.noiseSd}. Spent $${verdict.costUsd.spent}.`);
  if (verdict.recorded.length) lines.push(`Recorded as version ${verdict.recorded.join(" and ")}.`);
  return lines.join("\n");
}

/** 0 better, 1 inconclusive or worse, 2 invalid. */
function exitCode(verdict: Verdict): number {
  switch (verdict.decision) {
    case "better":
      return 0;
    case "invalid":
      return 2;
    default:
      return 1;
  }
}

async function compare(
  positionals: string[],
  values: Record<string, string | boolean | undefined>,
): Promise<number> {
  if (positionals.length > 2) throw new UsageError("Name at most a head and a base.");
  const home = benchHome(values.home as string | undefined);
  const config = readConfig(home);
  let vault: CaseVault;
  if (typeof values.plain === "string") {
    const plain = new PlainVault(path.resolve(values.plain));
    if ((await plain.describe()).cases.some((item) => !item.placeholder))
      throw new UsageError(
        "--plain takes placeholder cases only: seal real cases and score with the sealed file.",
      );
    vault = plain;
  } else {
    if (!config.vault)
      throw new UsageError(`${path.join(home, "bench.json")} must name the sealed vault.`);
    vault = new SealedVault(
      path.resolve(home, config.vault),
      await askHidden("Bench passphrase: "),
    );
  }
  const log = (line: string) => process.stderr.write(`${line}\n`);
  const agentId = config.agent ?? DEFAULT_AGENT;
  const bench = createActivityBench({
    repo: REPO,
    home,
    project: config.project,
    agentId,
    host: new IsolatedServer({ repo: REPO, home, project: config.project, agentId, log }),
    vault,
    checks: new HarnessCheckRunner(await evaluatorBrowser(home)),
    record: vault.sealed,
    trialEstimateUsd: config.trialEstimateUsd ?? 3,
    ...(config.mainRef ? { mainRef: config.mainRef } : {}),
    claude: values["no-claude"] !== true,
    log,
    ...(values.yes === true
      ? {}
      : {
          confirm: (estimate: number) =>
            askYes(`Spend up to $${estimate} on this comparison? [y/N] `),
        }),
  });
  const verdict = await bench.compare({
    ...(positionals[0] ? { head: positionals[0] } : {}),
    ...(positionals[1] ? { base: positionals[1] } : {}),
    trials: number(values.trials as string | undefined, "trials", DEFAULT_TRIALS, true),
    maxCostUsd: number(values["max-cost"] as string | undefined, "max-cost", DEFAULT_MAX_COST_USD),
  });
  process.stdout.write(
    values.json ? `${JSON.stringify(verdict, null, 2)}\n` : `${describe(verdict)}\n`,
  );
  return exitCode(verdict);
}

async function seal(
  positionals: string[],
  values: Record<string, string | boolean | undefined>,
): Promise<number> {
  const [source] = positionals;
  const bench = values.bench;
  if (!source || typeof bench !== "string")
    throw new UsageError("Use: pnpm bench seal <private source> --bench <id>");
  const home = benchHome(values.home as string | undefined);
  const plain = new PlainVault(path.resolve(source));
  const set = await plain.describe();
  if (set.bench !== bench)
    throw new UsageError(`${source} holds bench ${set.bench}, not ${bench}.`);
  const out = path.resolve(
    typeof values.out === "string" ? values.out : path.join(home, "vault", `${bench}.sealed`),
  );
  for (const root of [REPO, path.join(os.homedir(), ".penguin")])
    if (within(root, out)) throw new UsageError(`Seal outside ${root}: an optimiser works there.`);
  const passphrase = await askHidden("Passphrase for the sealed bench: ");
  if ((await askHidden("Again: ")) !== passphrase) throw new UsageError("The passphrases differ.");
  await proveAndSeal(
    plain,
    new HarnessCheckRunner(await evaluatorBrowser(home)),
    passphrase,
    out,
    (line) => process.stderr.write(`${line}\n`),
  );
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      trials: { type: "string" },
      "max-cost": { type: "string" },
      json: { type: "boolean" },
      "no-claude": { type: "boolean" },
      yes: { type: "boolean" },
      plain: { type: "string" },
      home: { type: "string" },
      bench: { type: "string" },
      out: { type: "string" },
    },
  });
  if (positionals[0] === "seal") return seal(positionals.slice(1), values);
  if (positionals[0] === "serve") throw new UsageError("pnpm bench serve comes with phase 3.");
  return compare(positionals, values);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    const usage =
      error instanceof UsageError ||
      (error as { code?: string })?.code?.startsWith("ERR_PARSE_ARGS");
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(usage ? 64 : 2);
  },
);
