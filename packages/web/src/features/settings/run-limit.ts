/**
 * The activity run time limit's picker, as plain values: the limits it offers, in whole minutes,
 * and how a pick travels through the select. The server owns the bounds and refuses anything
 * outside them; every limit offered here is inside.
 */

/** The limits the picker offers besides "each kind's own", in minutes. */
export const RUN_LIMIT_PRESETS: readonly number[] = [15, 30, 60, 90, 120, 180, 240, 480, 720, 1440];

/**
 * The limits to offer, shortest first: the presets, and the stored one too when it is none of
 * them (set through the API), so the picker can show what is in force.
 */
export function runLimitChoices(stored: number | null): number[] {
  const choices = [...RUN_LIMIT_PRESETS];
  if (stored !== null && !choices.includes(stored)) choices.push(stored);
  return choices.sort((a, b) => a - b);
}

/** A limit as the select carries it: "" for each kind's own. */
export function runLimitValue(minutes: number | null): string {
  return minutes === null ? "" : String(minutes);
}

/** A picked value as the server stores it: null for each kind's own. */
export function runLimitOf(value: string): number | null {
  return value === "" ? null : Number(value);
}
