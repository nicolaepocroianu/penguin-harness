/**
 * The noise-aware verdict (decision 12): paired bootstrap intervals over cases and their trials,
 * the measured noise, and the rule that turns them into better, worse or inconclusive.
 *
 * Pairs: a case's trial t on base and its trial t on head ran in the same block, so their
 * difference is one paired observation. Cases are resampled, then each case's paired
 * differences, so both the spread between cases and the spread between trials widen the
 * interval. A fixed seed makes a verdict reproducible from its evaluation.
 */
import { createHash } from "node:crypto";
import type { Guardrail, Interval } from "./types.js";

/** One case's paired differences (head minus base, one per trial), and its weight. */
export interface PairedCase {
  weight: number;
  diffs: number[];
}

const ITERATIONS = 10_000;

/** A reproducible uniform generator (mulberry32) seeded from text. */
export function seeded(seed: string): () => number {
  let state = createHash("sha256").update(seed).digest().readUInt32LE(0);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mean(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function variance(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const centre = mean(values);
  return values.reduce((sum, value) => sum + (value - centre) ** 2, 0) / (values.length - 1);
}

function weightedMean(values: readonly number[], weights: readonly number[]): number {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return total > 0 ? values.reduce((sum, value, i) => sum + value * weights[i]!, 0) / total : 0;
}

/** The weighted mean of the cases' mean differences, and its paired-bootstrap 90% interval. */
export function pairedBootstrap(
  cases: readonly PairedCase[],
  seed: string,
): { delta: number; ci90: Interval } {
  const usable = cases.filter((item) => item.diffs.length > 0);
  if (!usable.length) return { delta: 0, ci90: [0, 0] };
  const delta = weightedMean(
    usable.map((item) => mean(item.diffs)),
    usable.map((item) => item.weight),
  );
  const random = seeded(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const samples = new Float64Array(ITERATIONS);
  for (let i = 0; i < ITERATIONS; i++) {
    const values: number[] = [];
    const weights: number[] = [];
    for (let c = 0; c < usable.length; c++) {
      const item = pick(usable);
      let sum = 0;
      for (let d = 0; d < item.diffs.length; d++) sum += pick(item.diffs);
      values.push(sum / item.diffs.length);
      weights.push(item.weight);
    }
    samples[i] = weightedMean(values, weights);
  }
  samples.sort();
  const at = (q: number) => samples[Math.min(ITERATIONS - 1, Math.floor(q * ITERATIONS))]!;
  return { delta: round(delta), ci90: [round(at(0.05)), round(at(0.95))] };
}

/** How far one trial's score strays from its cell's mean: the pooled within-cell SD. */
export function noiseSd(cells: readonly (readonly number[])[]): number {
  let squares = 0;
  let freedom = 0;
  for (const cell of cells) {
    if (cell.length < 2) continue;
    squares += variance(cell) * (cell.length - 1);
    freedom += cell.length - 1;
  }
  return round(freedom ? Math.sqrt(squares / freedom) : 0);
}

/**
 * The smallest dev rise that counts: max(2 points, 2 × the paired standard error of the
 * case-mean difference). With one case the error comes from the trial noise alone.
 */
export function minDetectable(cases: readonly PairedCase[], noise: number): number {
  const means = cases.filter((item) => item.diffs.length).map((item) => mean(item.diffs));
  const trials = Math.max(1, ...cases.map((item) => item.diffs.length));
  const error =
    means.length >= 2 ? Math.sqrt(variance(means) / means.length) : noise * Math.sqrt(2 / trials);
  return round(Math.max(2, 2 * error));
}

/**
 * Better when the dev interval is above 0 and the rise beats the noise, the held-out cases do
 * not fall (their interval is not wholly below 0, nor their mean below −δ), the non-regression
 * runtime does not fall, and no guardrail got worse. Worse when any interval is wholly below 0.
 */
export function decide(input: {
  dev: { delta: number; ci90: Interval };
  heldOut: { delta: number; ci90: Interval };
  nonRegression: { ci90: Interval } | null;
  minDetectable: number;
  worse: readonly Guardrail[];
}): "better" | "worse" | "inconclusive" {
  const below = (ci90: Interval) => ci90[1] < 0;
  if (
    below(input.dev.ci90) ||
    below(input.heldOut.ci90) ||
    (input.nonRegression && below(input.nonRegression.ci90))
  )
    return "worse";
  if (
    input.dev.ci90[0] > 0 &&
    input.dev.delta > input.minDetectable &&
    input.heldOut.delta >= -input.minDetectable &&
    !input.worse.length
  )
    return "better";
  return "inconclusive";
}

/** A guardrail got worse when head's paired interval over base lies wholly above 0. */
export function worsened(cases: readonly PairedCase[], seed: string): boolean {
  return pairedBootstrap(cases, seed).ci90[0] > 0;
}

export function round(value: number, places = 2): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}
