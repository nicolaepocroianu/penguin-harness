import { describe, expect, it } from "vitest";
import type { AcceptanceReport, QualityReport } from "@waterford/waf-harness-server/api";
import {
  checksBadge,
  checksFacts,
  readPlayerCheck,
  type PlayerCheckState,
} from "../src/features/activities/checks-model";
import type { QualityState } from "../src/features/activities/quality-model";
import type { TestState } from "../src/features/activities/test-results-model";

type Status = "passed" | "failed" | "skipped";
const result = (status: Status) => ({
  criterion: "c",
  testName: "t",
  status,
  durationMs: 1,
  error: null,
});
const tests = (statuses: Status[], stale = false): TestState => ({
  report: {
    overallStatus: statuses.includes("failed") ? "failed" : "passed",
    results: statuses.map(result),
    checkedAt: "2026-10-09T08:00:00Z",
    specRevision: "r1",
    reused: false,
  } as AcceptanceReport,
  runId: "run",
  criteria: statuses.length,
  stale,
  browserInstalled: true,
});
const report = (status: QualityReport["status"], waived: (string | undefined)[]): QualityReport =>
  ({
    status,
    checkedAt: "2026-10-09T08:00:00Z",
    findings: waived.map((reason, index) => ({ id: `f-${index}`, waived: reason })),
  }) as unknown as QualityReport;
const quality = (accessibility: QualityReport, readability: QualityReport): QualityState => ({
  quality: { runId: "run", accessibility, readability },
  browserInstalled: true,
});
const player = (statuses: Status[], untrusted = false): PlayerCheckState => ({
  runId: "build",
  gap: null,
  report: {
    overallStatus: statuses.includes("failed") ? "failed" : "passed",
    results: statuses.map(result),
    checkedAt: "2026-10-12T18:17:00Z",
    ...(untrusted ? { untrusted: true as const } : {}),
  },
});
const clean = quality(report("passed", []), report("passed", []));

describe("the player check, as the server answered", () => {
  it("reads a report, and why a build has none", () => {
    expect(readPlayerCheck(player(["passed"]))).toEqual(player(["passed"]));
    expect(readPlayerCheck({ runId: "build", report: null, gap: "noBrowser" })).toEqual({
      runId: "build",
      report: null,
      gap: "noBrowser",
    });
    expect(readPlayerCheck({ runId: null, report: null, gap: null })).toEqual({
      runId: null,
      report: null,
      gap: null,
    });
  });

  it("reads anything it does not recognise as nothing", () => {
    expect(readPlayerCheck("nonsense")).toEqual({ runId: null, report: null, gap: null });
    expect(
      readPlayerCheck({
        runId: "build",
        report: { overallStatus: "great", results: [] },
        gap: "x",
      }),
    ).toEqual({ runId: "build", report: null, gap: null });
    // A report with no build behind it is not one.
    expect(readPlayerCheck({ ...player(["passed"]), runId: 7 }).report).toBeNull();
  });
});

describe("the three checks together", () => {
  it("waits for the tests and quality to be read, since unread is not unrun", () => {
    expect(checksFacts({ tests: null, quality: clean, player: null, running: false })).toBeNull();
    expect(
      checksFacts({ tests: tests(["passed"]), quality: null, player: null, running: false }),
    ).toBeNull();
  });

  it("counts each check's results, leaving waived findings and skipped reports out", () => {
    expect(
      checksFacts({
        tests: tests(["passed", "failed", "skipped"]),
        quality: quality(
          report("passed_with_warnings", [undefined, "vpat"]),
          report("failed", [undefined]),
        ),
        player: player(["passed", "failed"], true),
        running: true,
      }),
    ).toEqual({
      running: true,
      criteria: 3,
      tests: { passed: 1, failed: 1, stale: false },
      quality: { findings: 2, failed: true },
      player: { passed: 1, failed: 1, untrusted: true },
      playerGap: null,
    });
    const none = checksFacts({
      tests: { ...tests([]), report: null, criteria: 0 },
      quality: { quality: null, browserInstalled: true },
      player: { runId: "build", report: null, gap: "notRun" },
      running: false,
    });
    expect(none).toEqual({
      running: false,
      criteria: 0,
      tests: null,
      quality: null,
      player: null,
      playerGap: "notRun",
    });
  });
});

describe("the Checks tool's mark on the rail", () => {
  const badge = (input: Partial<Parameters<typeof checksFacts>[0]>) =>
    checksBadge(
      checksFacts({
        tests: tests(["passed"]),
        quality: clean,
        player: null,
        running: false,
        ...input,
      }),
    );

  it("pulses while a check runs", () => {
    expect(badge({ running: true, tests: tests(["failed"]) })).toEqual({
      text: "",
      tone: "busy",
      label: "running",
    });
  });

  it("counts failures across the tests and the player check, before findings", () => {
    expect(
      badge({ tests: tests(["passed", "failed", "failed"]), player: player(["failed"]) }),
    ).toEqual({
      text: "3",
      tone: "danger",
      label: "3 failing",
    });
    expect(
      badge({ quality: quality(report("failed", [undefined]), report("passed", [])) }),
    ).toMatchObject({ tone: "danger", label: "1 finding" });
    expect(
      badge({
        quality: quality(
          report("passed_with_warnings", [undefined, "vpat"]),
          report("passed", [undefined]),
        ),
      }),
    ).toEqual({ text: "2", tone: "attention", label: "2 findings" });
  });

  it("lets failures on an earlier specification recede, and says nothing when all is clear", () => {
    expect(badge({ tests: tests(["failed"], true) })).toBeNull();
    expect(badge({ player: player(["passed"]) })).toBeNull();
    expect(checksBadge(null)).toBeNull();
  });
});
