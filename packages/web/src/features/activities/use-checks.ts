/**
 * The three checks as the studio reads them: the acceptance tests, the quality checks and the
 * player check of the build the preview plays. Each is read through the activity's shared cache
 * once per settled run and draft revision, so the rail's mark, the journey's Checks step and an
 * open Checks panel all show one read.
 */
import { useMemo } from "react";
import type { ActivityRunSummary } from "@prismshadow/penguin-server/api";
import type { ActivityClient } from "./activity-client";
import {
  checksBadge,
  checksFacts,
  readPlayerCheck,
  type ChecksFacts,
  type PanelBadge,
  type PlayerCheckState,
} from "./checks-model";
import { readQualityState, type QualityState } from "./quality-model";
import { indexRuns } from "./runs-index";
import { readTestState, type TestState } from "./test-results-model";
import { useResource } from "./use-resource";

/**
 * Which read of a report a view wants: a new one whenever the latest run of its kind settles
 * or another starts, or the draft changes. The rail and the panels ask by the same version.
 */
export function reportVersion(runKey: string, revision: string): string {
  return `${runKey}|${revision}`;
}

/** Which read of the player check: a new one whenever the build the preview plays changes. */
export function playerCheckVersion(playingRunId: string | null): string {
  return playingRunId ?? "none";
}

export interface ChecksRead {
  tests: TestState | null;
  quality: QualityState | null;
  player: PlayerCheckState | null;
  /** The three together; null until the tests and quality have been read. */
  facts: ChecksFacts | null;
  /** The Checks tool's mark on the rail. */
  badge: PanelBadge | null;
}

export function useChecks(
  { api, cache }: ActivityClient,
  runs: readonly ActivityRunSummary[],
  revision: string,
  playingRunId: string | null,
  enabled: boolean,
): ChecksRead {
  const runIndex = indexRuns(runs);
  const latestTest = runIndex.latest("test");
  const latestQuality = runIndex.latest("quality");
  const testKey = latestTest ? `${latestTest.runId}:${latestTest.status}` : "";
  const qualityKey = latestQuality ? `${latestQuality.runId}:${latestQuality.status}` : "";
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
  const playerRead = useResource(
    cache,
    api.playerCheck,
    enabled ? playerCheckVersion(playingRunId) : null,
  );
  // A check whose read failed says nothing rather than something wrong; its panel says why.
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
  const player = useMemo(
    () =>
      playerRead.error || playerRead.data === undefined ? null : readPlayerCheck(playerRead.data),
    [playerRead],
  );
  const running = latestTest?.status === "running" || latestQuality?.status === "running";
  const facts = enabled ? checksFacts({ tests, quality, player, running }) : null;
  return { tests, quality, player, facts, badge: checksBadge(facts) };
}
