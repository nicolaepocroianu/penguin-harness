/**
 * The Activity storage page's logic: which number of kept runs it asks the server for, when a
 * dry run still answers the choice on screen (only then may it be confirmed), and what a report
 * adds up to.
 */
import { describe, expect, it } from "vitest";
import type { RunCleanupReport } from "@prismshadow/penguin-server/api";
import {
  KEEP_DEFAULT,
  KEEP_MAX,
  KEEP_MIN,
  answers,
  parseKeep,
  reportTotal,
} from "../src/features/admin/run-cleanup-model";

const report: RunCleanupReport = {
  keepNewest: 5,
  orphanTakes: true,
  categories: [
    { category: "stagedCopies", items: 2, bytes: 300 },
    { category: "olderRuns", items: 1, bytes: 1000 },
    { category: "orphanTakes", items: 4, bytes: 24 },
  ],
  unreadActivities: 0,
  failed: 0,
};

describe("the Activity storage page", () => {
  it("asks for a whole number of kept runs within the server's bounds", () => {
    expect(parseKeep(String(KEEP_DEFAULT))).toBe(5);
    expect(parseKeep(` ${KEEP_MIN} `)).toBe(KEEP_MIN);
    expect(parseKeep(String(KEEP_MAX))).toBe(KEEP_MAX);
    for (const text of ["", "0", String(KEEP_MAX + 1), "2.5", "-1", "five", "1e2"])
      expect(parseKeep(text)).toBeNull();
  });

  it("confirms a dry run only for the choice it was made for", () => {
    expect(answers(report, { keepNewest: 5, orphanTakes: true })).toBe(true);
    expect(answers(report, { keepNewest: 4, orphanTakes: true })).toBe(false);
    expect(answers(report, { keepNewest: 5, orphanTakes: false })).toBe(false);
  });

  it("adds up every category of a report", () => {
    expect(reportTotal(report)).toEqual({ items: 7, bytes: 1324 });
    expect(reportTotal({ ...report, categories: [] })).toEqual({ items: 0, bytes: 0 });
  });
});
