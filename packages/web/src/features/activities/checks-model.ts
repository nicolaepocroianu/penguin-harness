/**
 * What the three checks say together, decided without a DOM: the acceptance tests, the quality
 * checks and the player check the playing build ran at assembly. One summary feeds the Checks
 * tool's mark on the rail and the journey's Checks step, so the two never disagree.
 *
 * Each check reads its own route; the player check's answer is read here as defensively as the
 * other two are in their models.
 */
import type {
  AcceptanceResult,
  AcceptanceResultStatus,
  PlayerCheckGap,
  PlayerCheckReport,
} from "@waterford/waf-harness-server/api";
import { S } from "../../lib/strings";
import type { Tone } from "../../lib/tone";
import type { QualityState } from "./quality-model";
import type { TestState } from "./test-results-model";

/** A rail tool's mark: a figure, or a dot while its run is in progress; the words go to a reader. */
export interface PanelBadge {
  /** The figure on the mark; empty for a run in progress, which shows as a dot. */
  text: string;
  tone: Tone;
  /** The badge in words, for whoever cannot see it. */
  label: string;
}

/** The player check of the build the preview plays, as the server answered. */
export interface PlayerCheckState {
  /** The build the preview plays; null when there is none. */
  runId: string | null;
  report: PlayerCheckReport | null;
  gap: PlayerCheckGap | null;
}

const STATUSES: readonly AcceptanceResultStatus[] = ["passed", "failed", "skipped"];
const isStatus = (value: unknown): value is AcceptanceResultStatus =>
  STATUSES.includes(value as AcceptanceResultStatus);

function isResult(value: unknown): value is AcceptanceResult {
  const result = value as AcceptanceResult;
  return (
    !!result &&
    typeof result === "object" &&
    typeof result.criterion === "string" &&
    isStatus(result.status) &&
    typeof result.durationMs === "number"
  );
}

/** The server's answer, read defensively: anything it does not recognise reads as nothing. */
export function readPlayerCheck(value: unknown): PlayerCheckState {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const report = raw.report as PlayerCheckReport | null | undefined;
  const valid =
    !!report &&
    isStatus(report.overallStatus) &&
    typeof report.checkedAt === "string" &&
    Array.isArray(report.results) &&
    report.results.every(isResult);
  const runId = typeof raw.runId === "string" ? raw.runId : null;
  return {
    runId,
    report: runId && valid ? report : null,
    gap: runId && (raw.gap === "noBrowser" || raw.gap === "notRun") ? raw.gap : null,
  };
}

/** What the checks found, each null while it has not run on this activity. */
export interface ChecksFacts {
  /** A test or quality run is going now. */
  running: boolean;
  /** How many acceptance criteria the saved specification has; tests need some. */
  criteria: number;
  tests: { passed: number; failed: number; stale: boolean } | null;
  /** Open findings across both quality checks; waived ones are settled. */
  quality: { findings: number; failed: boolean } | null;
  /** The playing build's player check; null with no build, or a build that was not checked. */
  player: { passed: number; failed: number; untrusted: boolean } | null;
  /** Why the playing build was not checked in the player; null when it was, or with no build. */
  playerGap: PlayerCheckGap | null;
}

const count = (results: readonly { status: string }[], status: string) =>
  results.filter((result) => result.status === status).length;

/**
 * The three reads as one set of facts; null until both the tests and quality have been read,
 * since a check not read yet is not a check that never ran. The player check only adds to them.
 */
export function checksFacts(input: {
  tests: TestState | null;
  quality: QualityState | null;
  player: PlayerCheckState | null;
  running: boolean;
}): ChecksFacts | null {
  const { tests, quality, player } = input;
  if (!tests || !quality) return null;
  const report = tests.report;
  const results = quality.quality
    ? [quality.quality.accessibility, quality.quality.readability]
    : null;
  return {
    running: input.running,
    criteria: tests.criteria,
    // A skipped report (no criteria) has nothing to say.
    tests:
      report && report.results.length
        ? {
            passed: count(report.results, "passed"),
            failed: count(report.results, "failed"),
            stale: tests.stale,
          }
        : null,
    quality: results
      ? {
          findings: results.flatMap((entry) => entry.findings).filter((finding) => !finding.waived)
            .length,
          failed: results.some((entry) => entry.status === "failed"),
        }
      : null,
    player: player?.report
      ? {
          passed: count(player.report.results, "passed"),
          failed: count(player.report.results, "failed"),
          untrusted: player.report.untrusted === true,
        }
      : null,
    playerGap: player?.gap ?? null,
  };
}

/** How many checks failed: criteria on the saved specification, and the build's scenarios. */
export function failingChecks(facts: ChecksFacts): number {
  return (facts.tests && !facts.tests.stale ? facts.tests.failed : 0) + (facts.player?.failed ?? 0);
}

/**
 * The Checks tool's mark: a dot while a check runs, else only what wants a look — failures,
 * then open quality findings. Checks that pass say nothing on the rail.
 */
export function checksBadge(facts: ChecksFacts | null): PanelBadge | null {
  if (!facts) return null;
  const words = S.activities.checks.badge;
  if (facts.running) return { text: "", tone: "busy", label: words.running };
  const failing = failingChecks(facts);
  if (failing || facts.quality?.failed)
    return {
      text: String(failing + (facts.quality?.findings ?? 0)),
      tone: "danger",
      label: words.failing(failing, facts.quality?.findings ?? 0),
    };
  if (facts.quality?.findings)
    return {
      text: String(facts.quality.findings),
      tone: "attention",
      label: words.findings(facts.quality.findings),
    };
  return null;
}
