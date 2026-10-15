/**
 * The activity run time limit's picker: which limits it offers, how a pick travels through the
 * select and back, and how each limit is named.
 */
import { describe, expect, it } from "vitest";
import {
  RUN_LIMIT_PRESETS,
  runLimitChoices,
  runLimitOf,
  runLimitValue,
} from "../src/features/settings/run-limit";
import { S } from "../src/lib/strings";

describe("the run time limit picker", () => {
  it("offers the presets, and a stored limit that is none of them in its place", () => {
    expect(runLimitChoices(null)).toEqual([...RUN_LIMIT_PRESETS]);
    expect(runLimitChoices(90)).toEqual([...RUN_LIMIT_PRESETS]);
    const offered = runLimitChoices(100);
    expect(offered).toContain(100);
    expect(offered).toEqual([...offered].sort((a, b) => a - b));
  });

  it("carries each kind's own limit as an empty value, and a limit as its minutes", () => {
    expect(runLimitOf(runLimitValue(null))).toBeNull();
    for (const minutes of RUN_LIMIT_PRESETS)
      expect(runLimitOf(runLimitValue(minutes))).toBe(minutes);
  });

  it("names a limit in hours when it is whole hours, else in minutes", () => {
    const name = S.settings.wafWorkspace.runLimitMinutes;
    expect([1, 15, 60, 90, 120, 1440].map(name)).toEqual([
      "1 minute",
      "15 minutes",
      "1 hour",
      "90 minutes",
      "2 hours",
      "24 hours",
    ]);
  });
});
