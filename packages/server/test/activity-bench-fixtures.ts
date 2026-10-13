/**
 * What the activity bench's tests share: a throwaway git repository for head and base, the
 * placeholder cases, a check runner that answers by script, and a bench wired to the
 * ScriptedHost. Nothing here starts a server, a model or a browser.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createActivityBench, type BenchOptions } from "../../../scripts/activity-bench/bench.js";
import { ScriptedHost, type ScriptedTrial } from "../../../scripts/activity-bench/scripted-host.js";
import type {
  CaseVault,
  CheckRunner,
  HiddenChecks,
  TrialPlan,
} from "../../../scripts/activity-bench/types.js";
import { PlainVault } from "../../../scripts/activity-bench/vault.js";

export const PLACEHOLDER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../scripts/activity-bench/cases/placeholder",
);
export const CANARY = "PLACEHOLDER-BENCH-CANARY-3f9a7c215e8b4d06";
/** What a scripted trial's own tests are: the check runner tells them from hidden checks by it. */
export const OWN_TEST = "// the trial's own tests";

const temps: string[] = [];

export function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-test-"));
  temps.push(dir);
  return dir;
}

export function removeTemps(): void {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

/** The plugin's manifests in the first commit. */
export const MANIFEST = {
  name: "@penguinharness/waf-authoring",
  version: "0.2.14",
  files: ["skills"],
};
export const PLUGIN = { description: "Authoring WAF activities.", version: "2026.10.10.1" };
/** What a scripted check run that cannot run prints: no verdict or log may repeat it. */
export const RUNNER_SECRET = "The narration plays when the activity starts.";
/** A stage prompt's own module in the first commit, and the module that builds from it. */
export const PROMPT_MODULE = "packages/server/src/activities/prompts/spec.ts";
export const PROMPT_TEXT = [
  "/** What a specification run is told. */",
  'export const SPEC_RULES = "Write activity-spec.json.";',
  "export const SPEC_PROMPT = (values: { readonly task: string }) =>",
  "  `${values.task}\\n${SPEC_RULES}`;",
  "",
].join("\n");
export const PROMPT_BUILDER = "packages/server/src/activities/spec-prompts.ts";

export interface Repo {
  dir: string;
  git(...args: string[]): string;
  commit(files: Record<string, string>, message: string): string;
}

/** A repository whose first commit has a skill under the recipe surface and a server file. */
export function gitRepo(): Repo {
  const dir = tempDir();
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Bench",
        "-c",
        "user.email=bench@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.autocrlf=false",
        ...args,
      ],
      { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  const commit = (files: Record<string, string>, message: string) => {
    for (const [file, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), text);
    }
    git("add", "--", ...Object.keys(files));
    git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  };
  git("init", "-q", "-b", "main");
  git("config", "core.autocrlf", "false");
  commit(
    {
      "plugins/waf-authoring/skills/authoring/SKILL.md": "base\n",
      "plugins/waf-authoring/package.json": `${JSON.stringify(MANIFEST, null, 2)}\n`,
      "plugins/waf-authoring/plugin.json": `${JSON.stringify(PLUGIN, null, 2)}\n`,
      "packages/server/src/collect.ts": "export {};\n",
      [PROMPT_MODULE]: PROMPT_TEXT,
      [PROMPT_BUILDER]: 'export { SPEC_PROMPT } from "./prompts/spec.js";\n',
    },
    "base",
  );
  return { dir, git, commit };
}

/** A trial id's parts: `<evaluation>/<runtime>/<case>/<trial>/<side>`. */
export function parseTrial(id: string): {
  runtime: string;
  caseId: string;
  trial: number;
  side: "base" | "head";
} {
  const [, runtime, caseId, trial, side] = id.split("/");
  return {
    runtime: runtime!,
    caseId: caseId!,
    trial: Number(trial),
    side: side as "base" | "head",
  };
}

/** A check runner that passes the first `passed(...)` criteria of whatever it is given. */
export function scriptedChecks(
  passed: (trial: ReturnType<typeof parseTrial>, own: boolean) => number | null,
): CheckRunner & { calls: string[] } {
  const calls: string[] = [];
  return {
    fingerprint: "scripted",
    calls,
    async run(checks: HiddenChecks, playUrl: string) {
      const id = playUrl.replace("scripted://", "");
      const own = checks.test === OWN_TEST;
      calls.push(`${own ? "own" : "hidden"}:${id}`);
      const count = passed(parseTrial(id), own);
      if (count === null) return { ran: false as const, reason: `It printed: ${RUNNER_SECRET}` };
      return {
        ran: true as const,
        results: checks.criteria.map((criterion, i) => ({
          criterion,
          testName: criterion,
          status: i < count ? "passed" : "failed",
          error: null,
        })),
      };
    },
  };
}

/** Each placeholder case's own tests, as a trial's test run would write them: its criteria. */
export const OWN_TESTS: Record<string, HiddenChecks> = Object.fromEntries(
  await Promise.all(
    (await new PlainVault(PLACEHOLDER).describe()).cases.map(async (item) => [
      item.id,
      { ...(await new PlainVault(PLACEHOLDER).hidden(item.id)), test: OWN_TEST },
    ]),
  ),
);

export interface BenchFixture {
  repo: Repo;
  base: string;
  head: string;
  home: string;
  host: ScriptedHost;
  checks: ReturnType<typeof scriptedChecks>;
  vault: CaseVault;
  log: string[];
  bench: ReturnType<typeof createActivityBench>;
  /** A bench over the same repository, home and vault, with other parts swapped. */
  again(overrides?: Partial<BenchOptions>): ReturnType<typeof createActivityBench>;
}

export function benchFixture(
  options: {
    passed?: (trial: ReturnType<typeof parseTrial>, own: boolean) => number | null;
    script?: (trial: TrialPlan) => ScriptedTrial;
    claude?: true | string;
    refused?: string;
    vault?: CaseVault;
    home?: string;
  } & Partial<Pick<BenchOptions, "record" | "trialEstimateUsd" | "project" | "confirm">> = {},
): BenchFixture {
  const repo = gitRepo();
  const base = repo.git("rev-parse", "HEAD");
  const head = repo.commit({ "plugins/waf-authoring/skills/authoring/SKILL.md": "head\n" }, "head");
  const home = options.home ?? tempDir();
  const host = new ScriptedHost(tempDir(), options.script ?? (() => ({})), {
    ...(options.claude !== undefined ? { claude: options.claude } : {}),
    ...(options.refused !== undefined ? { refused: options.refused } : {}),
  });
  const checks = scriptedChecks(options.passed ?? (() => 2));
  const vault = options.vault ?? new PlainVault(PLACEHOLDER);
  const log: string[] = [];
  const settings: BenchOptions = {
    repo: repo.dir,
    home,
    project: options.project ?? "bench",
    host,
    vault,
    checks,
    record: options.record ?? false,
    trialEstimateUsd: options.trialEstimateUsd ?? 1,
    mainRef: "main",
    log: (line) => log.push(line),
    now: () => new Date("2026-10-13T12:00:00.000Z"),
    ...(options.confirm ? { confirm: options.confirm } : {}),
  };
  return {
    repo,
    base,
    head,
    home,
    host,
    checks,
    vault,
    log,
    bench: createActivityBench(settings),
    again: (overrides = {}) => createActivityBench({ ...settings, ...overrides }),
  };
}
