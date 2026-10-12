/**
 * One reading of an activity's run history: which run is newest, which are under way, and
 * which belong to one language and asset. Built once per runs list, so every panel that asks
 * reads the same order whatever order the list arrived in.
 *
 * Newest is the server's own order: `createdAt` descending, then `runId` descending. A run the
 * page puts in front of the list as it starts carries the server's `createdAt` like any other,
 * so where it sits in the array never decides which run is newest.
 */
import type { ActivityRunSummary } from "@prismshadow/penguin-server/api";

type Run = ActivityRunSummary;
export type RunKind = Run["kind"];

/** The language, and the asset where the kind has one, that a run works on. */
export interface RunTarget {
  language?: string;
  assetKey?: string;
}

export interface RunsIndex {
  /** Whether any run is under way. */
  readonly busy: boolean;
  /** The runs under way, newest first. */
  readonly running: readonly Run[];
  /**
   * A kind's runs, newest first; with a target, only those working on it. A kind with no
   * target of its own (a module, a test) matches no target.
   */
  of(kind: RunKind, target?: RunTarget): readonly Run[];
  /** The newest run of a kind, for a target when one is named, whatever its status. */
  latest(kind: RunKind, target?: RunTarget): Run | undefined;
  /** Whether a run of a kind for a target is under way. */
  isRunning(kind: RunKind, target?: RunTarget): boolean;
}

/** Where each kind keeps the language and asset it works on. */
const TARGETS: Partial<Record<RunKind, (run: Run) => RunTarget | undefined>> = {
  audio: (run) => run.audio,
  image: (run) => run.image,
  "media-text": (run) => run.mediaText,
  phonemes: (run) => run.phonemes,
  composition: (run) => run.composition,
  video: (run) => run.video,
  timeline: (run) => run.timelineEdit,
  critique: (run) => run.critique,
};

function newestFirst(left: Run, right: Run): number {
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? 1 : -1;
  return left.runId < right.runId ? 1 : left.runId > right.runId ? -1 : 0;
}

function matches(run: Run, target: RunTarget): boolean {
  if (target.language === undefined && target.assetKey === undefined) return true;
  const found = TARGETS[run.kind]?.(run);
  if (!found) return false;
  return (
    (target.language === undefined || found.language === target.language) &&
    (target.assetKey === undefined || found.assetKey === target.assetKey)
  );
}

function build(runs: readonly Run[]): RunsIndex {
  const sorted = [...runs].sort(newestFirst);
  const byKind = new Map<RunKind, Run[]>();
  for (const run of sorted) {
    const bucket = byKind.get(run.kind);
    if (bucket) bucket.push(run);
    else byKind.set(run.kind, [run]);
  }
  const running = sorted.filter((run) => run.status === "running");
  const of = (kind: RunKind, target: RunTarget = {}): readonly Run[] =>
    (byKind.get(kind) ?? []).filter((run) => matches(run, target));
  return {
    busy: running.length > 0,
    running,
    of,
    latest: (kind, target) => of(kind, target)[0],
    isRunning: (kind, target) => of(kind, target).some((run) => run.status === "running"),
  };
}

const built = new WeakMap<readonly Run[], RunsIndex>();

/**
 * The index of one runs list. The list is state the page replaces rather than changes, so the
 * index is kept per list: every panel handed the same list reads the same index.
 */
export function indexRuns(runs: readonly Run[]): RunsIndex {
  let index = built.get(runs);
  if (!index) {
    index = build(runs);
    built.set(runs, index);
  }
  return index;
}
