/**
 * The Activity storage page's logic, kept out of the view so node tests can pin it: which number
 * of kept runs it may ask for, whether a dry run still answers the choice on screen and is fresh
 * enough to confirm, and what a report adds up to.
 */
import type { RunCleanupOptions, RunCleanupReport } from "@prismshadow/penguin-server/api";

/** The server's own bounds and default (RUN_CLEANUP_KEEP_* in run-cleanup-types.ts). */
export const KEEP_DEFAULT = 5;
export const KEEP_MIN = 1;
export const KEEP_MAX = 100;

/** The number of runs to keep typed in the field, or null when it is not one the server takes. */
export function parseKeep(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= KEEP_MIN && value <= KEEP_MAX ? value : null;
}

/** Whether a report was made for these options, so confirming it removes what it lists. */
export function answers(report: RunCleanupReport, options: RunCleanupOptions): boolean {
  return report.keepNewest === options.keepNewest && report.orphanTakes === options.orphanTakes;
}

/**
 * How long a dry run on screen is confirmed as it is; an older one is made again when Clean up
 * is pressed. Well within the server's own limit (RUN_CLEANUP_PLAN_TTL_MS, ten minutes).
 */
export const PLAN_FRESH_MS = 5 * 60 * 1000;

/** Whether a dry run made at `madeAt` is too old to confirm at `now` without making it again. */
export function planIsStale(madeAt: number, now: number): boolean {
  return now - madeAt >= PLAN_FRESH_MS;
}

/** Everything a report counts, together. */
export function reportTotal(report: RunCleanupReport): { items: number; bytes: number } {
  return report.categories.reduce(
    (total, tally) => ({ items: total.items + tally.items, bytes: total.bytes + tally.bytes }),
    { items: 0, bytes: 0 },
  );
}
