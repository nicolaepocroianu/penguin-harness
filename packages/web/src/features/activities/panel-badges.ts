/**
 * What the Tests and Quality chips say beside their names, so an author can tell whether
 * either needs them without opening it: a run in progress, how many criteria failed or
 * passed, how many quality findings are open.
 *
 * The page reads the same two routes the panels read, once per settled run and draft
 * revision, through the activity's shared cache: a chip and an open panel show one read.
 */
import { useMemo } from "react";
import type { ActivityRunSummary } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import type { Tone } from "../../lib/tone";
import type { ActivityClient } from "./activity-client";
import { readQualityState, type QualityState } from "./quality-model";
import { indexRuns } from "./runs-index";
import { readTestState, type TestState } from "./test-results-model";
import { useResource } from "./use-resource";

export interface PanelBadge {
  /** The figure on the chip; empty for a run in progress, which shows as a dot. */
  text: string;
  tone: Tone;
  /** The badge in words, for whoever cannot see it. */
  label: string;
}

const running: () => PanelBadge = () => ({
  text: "",
  tone: "busy",
  label: S.activities.panelBadges.running,
});

/** Failed criteria outrank passed ones; a report for an older specification recedes. */
export function testBadge(state: TestState | null, inProgress: boolean): PanelBadge | null {
  if (inProgress) return running();
  const report = state?.report;
  if (!report || !report.results.length) return null;
  const words = S.activities.panelBadges;
  const failed = report.results.filter((result) => result.status === "failed").length;
  if (failed)
    return state.stale
      ? { text: String(failed), tone: "muted", label: words.staleFailed(failed) }
      : { text: String(failed), tone: "danger", label: words.failed(failed) };
  const passed = report.results.filter((result) => result.status === "passed").length;
  if (!passed) return null;
  return state.stale
    ? { text: String(passed), tone: "muted", label: words.stale(passed) }
    : { text: String(passed), tone: "success", label: words.passed(passed) };
}

/** Open findings across both checks; waived ones are settled and do not count. */
export function qualityBadge(state: QualityState | null, inProgress: boolean): PanelBadge | null {
  if (inProgress) return running();
  const quality = state?.quality;
  if (!quality) return null;
  const reports = [quality.accessibility, quality.readability];
  const open = reports.flatMap((report) => report.findings).filter((finding) => !finding.waived);
  if (!open.length) return null;
  const failed = reports.some((report) => report.status === "failed");
  return {
    text: String(open.length),
    tone: failed ? "danger" : "attention",
    label: S.activities.panelBadges.findings(open.length),
  };
}

/**
 * Which read of a report a view wants: a new one whenever the latest run of its kind settles
 * or another starts, or the draft changes. The chips and the panels ask by the same version.
 */
export function reportVersion(runKey: string, revision: string): string {
  return `${runKey}|${revision}`;
}

/** Both chips' badges, read again whenever a run settles or the draft changes. */
export function usePanelBadges(
  { api, cache }: ActivityClient,
  runs: readonly ActivityRunSummary[],
  revision: string,
  enabled: boolean,
): { tests: PanelBadge | null; quality: PanelBadge | null } {
  const runIndex = indexRuns(runs);
  const latestTest = runIndex.latest("test");
  const latestQuality = runIndex.latest("quality");
  const testKey = latestTest ? `${latestTest.runId}:${latestTest.status}` : "";
  const qualityKey = latestQuality ? `${latestQuality.runId}:${latestQuality.status}` : "";
  // The panels read with the same versions, so a chip and its open panel share each read.
  const testRead = useResource(
    cache,
    api.tests.report,
    enabled ? reportVersion(testKey, revision) : null,
  );
  const qualityRead = useResource(
    cache,
    api.quality.report,
    enabled ? reportVersion(qualityKey, revision) : null,
  );
  // A chip with nothing to say is the right answer to a read that failed.
  const tests = useMemo(
    () => (testRead.error || testRead.data === undefined ? null : readTestState(testRead.data)),
    [testRead],
  );
  const quality = useMemo(
    () =>
      qualityRead.error || qualityRead.data === undefined
        ? null
        : readQualityState(qualityRead.data),
    [qualityRead],
  );

  return {
    tests: enabled ? testBadge(tests, latestTest?.status === "running") : null,
    quality: enabled ? qualityBadge(quality, latestQuality?.status === "running") : null,
  };
}
