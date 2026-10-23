/**
 * The Evaluation Center's activity bench section, its pure parts: what a folder pick asks for,
 * and the order a scoreboard's evaluations are read in. Kept apart from the section so a test can
 * pin them without a DOM.
 */
import type { BenchmarkEvaluation } from "@waterford/waf-harness-server/api";

/** The bench home a folder pick asks for: an empty pick forgets it. */
export function benchHomeChoice(picked: string): string | null {
  const home = picked.trim();
  return home === "" ? null : home;
}

/** A scoreboard's evaluations newest first: the order they were recorded in, reversed. */
export function newestFirst(evaluations: readonly BenchmarkEvaluation[]): BenchmarkEvaluation[] {
  return [...evaluations].reverse();
}
