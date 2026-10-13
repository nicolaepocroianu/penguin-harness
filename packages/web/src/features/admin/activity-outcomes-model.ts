/**
 * The Activity outcomes page's pure parts: which run kinds it offers, how far back it reads, and
 * how one tally of the outcome ledger reads as a row — how many runs, how many succeeded, and
 * what became of them after they ended. Kept apart from the page so a test can pin them without a
 * DOM.
 */
import type {
  ActivityRun,
  OutcomeDimension,
  OutcomeFact,
  OutcomeTally,
  RunRecipe,
} from "@prismshadow/penguin-server/api";

export type OutcomeKind = ActivityRun["kind"];

/**
 * Every kind a run records, in roughly the order the Stages make them. A record rather than a
 * list, so a new kind does not compile until it is placed here.
 */
const KIND_ORDER: Record<OutcomeKind, number> = {
  spec: 0,
  "media-spec": 1,
  audio: 2,
  image: 3,
  "media-text": 4,
  phonemes: 5,
  composition: 6,
  video: 7,
  timeline: 8,
  critique: 9,
  assessment: 10,
  module: 11,
  test: 12,
  quality: 13,
  assist: 14,
};

export const OUTCOME_KINDS: readonly OutcomeKind[] = (
  Object.keys(KIND_ORDER) as OutcomeKind[]
).sort((a, b) => KIND_ORDER[a] - KIND_ORDER[b]);

/** The most runs the ledger lists for one tally (the server's RUNS_LISTED). */
export const RUNS_LISTED = 50;

/** How the page groups a kind's runs: by their whole recipe, or by who answered. */
export type OutcomeGrouping = Extract<OutcomeDimension, "recipe" | "runtime">;

/** How far back the page reads, by when runs started. */
export type OutcomeWindow = "7d" | "30d" | "90d" | "all";

export const OUTCOME_WINDOWS: readonly OutcomeWindow[] = ["7d", "30d", "90d", "all"];

const WINDOW_DAYS: Record<Exclude<OutcomeWindow, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/** The earliest start a window counts, as an ISO time; undefined for all time. */
export function windowSince(window: OutcomeWindow, now: Date): string | undefined {
  if (window === "all") return undefined;
  return new Date(now.getTime() - WINDOW_DAYS[window] * 24 * 60 * 60 * 1000).toISOString();
}

/** One tally, as its row reads it. */
export interface OutcomeRowValues {
  runs: number;
  succeeded: number;
  /** Of the runs, the share that succeeded, in whole percent. */
  successPercent: number;
  /** Runs whose pass wrote a specification that failed its checks, which a repair round answers. */
  repaired: number;
  /** Runs whose candidate became part of the draft. */
  accepted: number;
  /** Edits made to what the runs wrote: by authors, by the Stages, or by later runs. */
  edits: number;
  /** Times what the runs wrote was taken back to what was there before. */
  reverted: number;
  deployedQa: number;
  deployedProd: number;
  /** Runs whose checks rested on files the run changed, so nothing vouches for what they found. */
  untrusted: number;
}

export function outcomeRow(tally: OutcomeTally): OutcomeRowValues {
  const metric = (name: string) => tally.metrics[name] ?? 0;
  const succeeded = metric("succeeded");
  return {
    runs: tally.runs,
    succeeded,
    successPercent: tally.runs > 0 ? Math.round((succeeded / tally.runs) * 100) : 0,
    repaired: metric("repairable"),
    accepted: metric("accepted"),
    edits: metric("edits.author") + metric("edits.stages") + metric("edits.run"),
    reverted: metric("reverted"),
    deployedQa: metric("deployed.qa"),
    deployedProd: metric("deployed.prod"),
    untrusted: metric("tests.untrusted") + metric("playerCheck.untrusted"),
  };
}

/** What a recipe is made of, as the page names it. */
export interface RecipeParts {
  /** Who answered: `agent:<provider>/<model>`, `coding:<id>`, `helper:…`, `server`, … */
  runtime: string;
  penguin: string;
  /** Each bundled plugin the runs were given, as `<plugin> <version>`. */
  libraries: string[];
  /** The acceptance harness version a module or test run was given. */
  harness: number | null;
}

export function recipeParts(recipe: RunRecipe): RecipeParts {
  return {
    runtime: recipe.runtime,
    penguin: recipe.penguin,
    libraries: recipe.library.map((library) => `${library.plugin} ${library.version}`),
    harness: recipe.harness ?? null,
  };
}

/** A digest's first twelve characters: enough to tell recipes apart at a glance. */
export function shortKey(key: string): string {
  return /^[0-9a-f]{32,}$/.test(key) ? key.slice(0, 12) : key;
}

/**
 * A fact's detail as one line of `name: value` pairs, nested names joined with a dot and digests
 * shortened. A fact holds numbers, digests and ids only, never what an author or agent wrote.
 */
export function factDetail(detail: OutcomeFact["detail"]): string {
  const pairs: string[] = [];
  const visit = (prefix: string, value: unknown) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const [name, inner] of Object.entries(value as Record<string, unknown>))
        visit(prefix ? `${prefix}.${name}` : name, inner);
      return;
    }
    const text = Array.isArray(value) ? value.map(String).join(", ") : String(value);
    pairs.push(`${prefix}: ${shortKey(text)}`);
  };
  visit("", detail);
  return pairs.join(" · ");
}
