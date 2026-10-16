/**
 * Cleaning up activity runs: what an admin starts, by hand, to win back the disk run folders
 * take. It is never scheduled. A dry run (`plan`) counts what would go, per category; `apply`
 * works the same choice out again, as things stand then, and removes only that.
 *
 * What it removes, in this order (see `RunCleanupCategory`):
 *
 *   1. In a finished module run: the media its assembly was staged with (`media/`), and the
 *      packages its agent installed itself (`module/node_modules` as a real folder; a link to
 *      the shared module packages is left as it is).
 *   2. The folders of finished runs beyond the newest `keepNewest` of their activity and kind.
 *      The newest succeeded run of each kind is kept as well, however many failed after it.
 *   3. Only when asked for: takes nobody accepted (`candidates/<runId>.<ext>` in a ref's media
 *      folder) of runs this server no longer has, in the managed WAF checkout's media, while
 *      the media repository is held.
 *
 * What it never removes, of an activity's runs:
 *
 * - a run still running;
 * - the module build the preview plays (the pinned one, while it is a succeeded build), the
 *   newest succeeded build, which a deploy ships, the pinned run whatever it is, and a run a
 *   live play link plays;
 * - a repair's sources: the build and test run every repair round started from, and a build a
 *   finished test run played while it is still of the current draft, with that test run, since
 *   a repair round may yet start from them;
 * - a run the outcome ledger points at: one the draft's parts came from, or one credited with a
 *   deploy;
 * - the whole folder of a run whose folder is what it made: test and quality runs (their
 *   reports), compositions (the page and images a recording plays), recordings and timeline
 *   renders;
 * - anything at all of an activity whose draft cannot be read (an archived one, or one whose
 *   files are not there): its runs are counted in `unreadActivities` instead.
 *
 * A link is never followed, neither to count its bytes nor to remove what it points to. A folder
 * or file that cannot be removed is left in place and the server log names it.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Component, Interface, Use } from "@prismshadow/penguin-core/kernel";
import type { Config, Log } from "../hmr/capabilities.js";
import { HttpError } from "../http/errors.js";
import type { ActivityAuthoring } from "../mechanisms/activities.js";
import type { ActivityLock } from "./activity-lock.js";
import type { ActivityDraft, ActivityRunKind, ActivityRunSummary } from "./domain.js";
import { playingBuild } from "./module-builds.js";
import type { ActivityOutcomes } from "./outcomes.js";
import type { ActivityPlayLinks } from "./play-links.js";
import {
  RUN_CLEANUP_KEEP_MAX,
  RUN_CLEANUP_KEEP_MIN,
  type RunCleanupCategory,
  type RunCleanupOptions,
  type RunCleanupReport,
  type RunStorage,
} from "./run-cleanup-types.js";
import { realFolder, runsRoot, type ActivityRuns } from "./run-store.js";
import type { ActivitySandbox } from "./sandbox-service.js";
import type { WafWorkspace } from "./waf-workspace.js";

export abstract class ActivityRunCleanup extends Interface<{
  /** The disk every run folder takes together. */
  storage(): Promise<RunStorage>;
  /** What a cleanup with these options would remove, removing nothing. */
  plan(options: RunCleanupOptions): Promise<RunCleanupReport>;
  /** Removes what `plan` would answer now, and answers what it removed. */
  apply(options: RunCleanupOptions): Promise<RunCleanupReport>;
}>() {}

/** Kinds whose folder is what they made, kept whole however old. */
const KEPT_WHOLE: ReadonlySet<ActivityRunKind> = new Set([
  "test",
  "quality",
  "composition",
  "video",
  "timeline",
]);

/** What a module run is staged with that nothing reads once it has finished. */
const STAGED_ENTRIES = ["media", "module/node_modules"] as const;

/** A take's file name in a ref's `candidates/`. */
const TAKE_FILE = /^(run_[a-f0-9]{32})\.[A-Za-z0-9]+$/;

type DraftView = Pick<ActivityDraft, "pinnedModuleRunId" | "contentRevision">;

/** What is kept across every activity: what live play links play, and what the ledger holds. */
interface Held {
  live: ReadonlySet<string>;
  ledger: ReadonlySet<string>;
}

/** Of one activity's runs, newest first, those whose folder goes and those whose staged copies do. */
export function chooseRuns(
  runs: readonly ActivityRunSummary[],
  draft: DraftView,
  held: Held,
  keepNewest: number,
): { olderRuns: ActivityRunSummary[]; stagedCopies: ActivityRunSummary[] } {
  const untouched = new Set<string>();
  const byId = new Map(runs.map((run) => [run.runId, run]));
  for (const run of runs) {
    if (run.status === "running" || held.live.has(run.runId) || held.ledger.has(run.runId))
      untouched.add(run.runId);
    if (run.repair) untouched.add(run.repair.fromRunId).add(run.repair.testRunId);
    // A build these tests played can still be repaired while it is of the current draft.
    const played = run.test?.moduleRunId ? byId.get(run.test.moduleRunId) : undefined;
    if (
      run.kind === "test" &&
      run.status === "succeeded" &&
      played?.inputRevision === draft.contentRevision
    )
      untouched.add(run.runId).add(played.runId);
  }
  if (draft.pinnedModuleRunId) untouched.add(draft.pinnedModuleRunId);
  for (const build of [playingBuild(runs, draft.pinnedModuleRunId), playingBuild(runs, null)])
    if (build) untouched.add(build.runId);

  const recent = new Set<string>();
  const seen = new Map<ActivityRunKind, number>();
  const succeeded = new Set<ActivityRunKind>();
  for (const run of runs) {
    const count = (seen.get(run.kind) ?? 0) + 1;
    seen.set(run.kind, count);
    if (count <= keepNewest) recent.add(run.runId);
    if (run.status === "succeeded" && !succeeded.has(run.kind)) {
      succeeded.add(run.kind);
      recent.add(run.runId);
    }
  }
  const olderRuns = runs.filter(
    (run) => !untouched.has(run.runId) && !recent.has(run.runId) && !KEPT_WHOLE.has(run.kind),
  );
  const going = new Set(olderRuns.map((run) => run.runId));
  const stagedCopies = runs.filter(
    (run) => run.kind === "module" && !untouched.has(run.runId) && !going.has(run.runId),
  );
  return { olderRuns, stagedCopies };
}

/**
 * The bytes of everything at `target` that is neither a link nor reached through one; null when
 * it is absent or is itself a link.
 */
async function treeBytes(target: string): Promise<number | null> {
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat || stat.isSymbolicLink()) return null;
  if (!stat.isDirectory()) return stat.size;
  const names = await fs.readdir(target).catch(() => [] as string[]);
  const sizes = await Promise.all(names.map((name) => treeBytes(path.join(target, name))));
  return sizes.reduce<number>((total, size) => total + (size ?? 0), 0);
}

/** The real folders directly inside `dir`, links left out. */
async function folders(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => path.join(dir, entry.name));
}

/** Every take in the media repository's refs (`loom/<pc>/<pc>-<ref>/candidates/`), with its run. */
async function takes(mediaDir: string): Promise<{ file: string; runId: string; bytes: number }[]> {
  const found: { file: string; runId: string; bytes: number }[] = [];
  for (const product of await folders(path.join(mediaDir, "loom")))
    for (const ref of await folders(product)) {
      const dir = await realFolder(ref, "candidates");
      if (!dir) continue;
      for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
        const runId = TAKE_FILE.exec(name)?.[1];
        if (!runId) continue;
        const file = path.join(dir, name);
        const stat = await fs.lstat(file).catch(() => null);
        if (stat?.isFile()) found.push({ file, runId, bytes: stat.size });
      }
    }
  return found;
}

function checkOptions(options: RunCleanupOptions): RunCleanupOptions {
  const { keepNewest, orphanTakes } = options;
  if (
    !Number.isSafeInteger(keepNewest) ||
    keepNewest < RUN_CLEANUP_KEEP_MIN ||
    keepNewest > RUN_CLEANUP_KEEP_MAX
  )
    throw new HttpError(
      400,
      "invalid_request",
      `keepNewest must be a whole number from ${RUN_CLEANUP_KEEP_MIN} to ${RUN_CLEANUP_KEEP_MAX}.`,
    );
  if (typeof orphanTakes !== "boolean")
    throw new HttpError(400, "invalid_request", "orphanTakes must be true or false.");
  return { keepNewest, orphanTakes };
}

@Component()
export class ActivityRunCleanupService implements ActivityRunCleanup {
  @Use() private readonly runs!: ActivityRuns;
  @Use() private readonly activities!: ActivityAuthoring;
  @Use() private readonly lock!: ActivityLock;
  @Use() private readonly links!: ActivityPlayLinks;
  @Use() private readonly outcomes!: ActivityOutcomes;
  @Use() private readonly wafWorkspace!: WafWorkspace;
  @Use() private readonly sandbox!: ActivitySandbox;
  @Use() private readonly config!: Config;
  @Use() private readonly log!: Log;

  /** One cleanup or dry run at a time, so two never count or remove the same folder. */
  private queue: Promise<unknown> = Promise.resolve();

  async storage(): Promise<RunStorage> {
    const root = runsRoot(this.config.root);
    const all = await folders(root);
    const sizes = await Promise.all(all.map((folder) => treeBytes(folder)));
    return {
      bytes: sizes.reduce<number>((total, size) => total + (size ?? 0), 0),
      folders: all.length,
    };
  }

  plan(options: RunCleanupOptions): Promise<RunCleanupReport> {
    const checked = checkOptions(options);
    return this.serial(() => this.cleanUp(checked, false));
  }

  apply(options: RunCleanupOptions): Promise<RunCleanupReport> {
    const checked = checkOptions(options);
    return this.serial(() => this.cleanUp(checked, true));
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => {}).then(work);
    this.queue = next;
    return next;
  }

  private async cleanUp(options: RunCleanupOptions, remove: boolean): Promise<RunCleanupReport> {
    const tally: Record<RunCleanupCategory, { items: number; bytes: number }> = {
      stagedCopies: { items: 0, bytes: 0 },
      olderRuns: { items: 0, bytes: 0 },
      orphanTakes: { items: 0, bytes: 0 },
    };
    const count = (category: RunCleanupCategory, bytes: number) => {
      tally[category].items += 1;
      tally[category].bytes += bytes;
    };
    let failed = 0;
    let unreadActivities = 0;

    const activities = new Map<string, string>();
    for (const run of this.runs.everyRun()) activities.set(run.activityId, run.projectId);
    for (const [activityId, projectId] of activities) {
      const work = async () => {
        const draft = await this.activities.getActivity(projectId, activityId).then(
          (activity) => activity.draft,
          () => null,
        );
        if (!draft) {
          unreadActivities += 1;
          return;
        }
        // Read again here: under the activity's lock, this is how things stand as they go.
        const runs = this.runs.summaries(projectId, activityId);
        const held = {
          live: new Set(this.links.liveRunIds()),
          ledger: new Set(await this.outcomes.heldRuns()),
        };
        const chosen = chooseRuns(runs, draft, held, options.keepNewest);

        const older: { runId: string; bytes: number }[] = [];
        for (const run of chosen.olderRuns) {
          const bytes = await treeBytes(this.runs.workspace(run.runId));
          if (bytes !== null) older.push({ runId: run.runId, bytes });
        }
        const left = new Set(
          remove ? await this.runs.removeWorkspaces(older.map(({ runId }) => runId)) : [],
        );
        const removed = older.filter(({ runId }) => !left.has(runId));
        for (const { bytes } of removed) count("olderRuns", bytes);
        failed += left.size;
        if (remove) this.sandbox.forgetRuns(removed.map(({ runId }) => runId));

        for (const run of chosen.stagedCopies)
          for (const entry of STAGED_ENTRIES) {
            const folder = await realFolder(this.runs.workspace(run.runId), entry);
            const bytes = folder === null ? null : await treeBytes(folder);
            if (bytes === null) continue;
            if (!remove || (await this.runs.removeFromWorkspace(run.runId, entry)))
              count("stagedCopies", bytes);
            else failed += 1;
          }
      };
      if (remove) await this.lock.run(activityId, work);
      else await work();
    }

    let takesUnavailable = false;
    if (options.orphanTakes) {
      const done = await this.wafWorkspace.withMedia(async (mediaDir) => {
        const found = await takes(mediaDir);
        // Read after the takes were listed: a run's row is written before its take, so a take
        // listed above whose run is not here has no run any more.
        const known = new Set(this.runs.everyRun().map((run) => run.runId));
        for (const take of found) {
          if (known.has(take.runId)) continue;
          if (remove) {
            try {
              await fs.rm(take.file, { force: true });
            } catch (error) {
              const code = (error as NodeJS.ErrnoException).code ?? String(error);
              this.log.line(`[activities] A take was left in place (${code}): ${take.file}`);
              failed += 1;
              continue;
            }
          }
          count("orphanTakes", take.bytes);
        }
        return true;
      });
      takesUnavailable = done === null;
    }

    const categories: RunCleanupCategory[] = ["stagedCopies", "olderRuns"];
    if (options.orphanTakes) categories.push("orphanTakes");
    return {
      keepNewest: options.keepNewest,
      orphanTakes: options.orphanTakes,
      categories: categories.map((category) => ({ category, ...tally[category] })),
      unreadActivities,
      ...(takesUnavailable ? { takesUnavailable: true as const } : {}),
      failed,
    };
  }
}
