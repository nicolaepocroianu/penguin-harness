/**
 * How long an activity run may work: its kind's own limit (`RunLimits`), or the one an admin set
 * for every run in System settings. The engine reads the admin's on every pass over the running
 * runs, so a change needs no restart and reaches runs already working.
 */
import { HttpError } from "../http/errors.js";
import { MINUTE_MS, type RunLimits } from "./run-kinds/contract.js";

/** Key of the admin's limit in `server_settings`, in whole minutes; absent, each kind's own. */
export const RUN_LIMIT_SETTING = "activityRunLimitMinutes";

/** Bounds of the admin's limit, in minutes. */
export const RUN_LIMIT_MIN_MINUTES = 1;
export const RUN_LIMIT_MAX_MINUTES = 24 * 60;

/**
 * The admin's limit as stored, in minutes; null when none was set, or the row is not a number
 * in bounds (a database edited by hand), so the kinds' own limits apply.
 */
export function readRunLimitMinutes(raw: string | null): number | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return isLimitMinutes(value) ? value : null;
  } catch {
    return null;
  }
}

/** A limit update: a whole number of minutes in bounds, or null for each kind's own. */
export function parseRunLimitMinutes(value: unknown): number | null {
  if (value === null || isLimitMinutes(value)) return value;
  throw new HttpError(
    400,
    "invalid_run_limit",
    `activityRunLimitMinutes must be null or a whole number of minutes from ${RUN_LIMIT_MIN_MINUTES} to ${RUN_LIMIT_MAX_MINUTES}.`,
  );
}

function isLimitMinutes(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= RUN_LIMIT_MIN_MINUTES &&
    value <= RUN_LIMIT_MAX_MINUTES
  );
}

/** How long a run of a kind may work, in milliseconds: the admin's limit, else the kind's own. */
export function wallClockLimitMs(
  limits: RunLimits | undefined,
  adminMinutes: number | null,
): number | undefined {
  return adminMinutes !== null ? adminMinutes * MINUTE_MS : limits?.wallClockMs;
}

/** Why a run its time limit stopped failed, as the run records it. */
export function timeLimitMessage(kind: string, limitMs: number): string {
  const minutes = Math.round(limitMs / MINUTE_MS);
  return `The ${kind} run was stopped after ${minutes} minute${minutes === 1 ? "" : "s"}, its time limit.`;
}
