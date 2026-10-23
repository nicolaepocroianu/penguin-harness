/**
 * Cleaning up activity runs: what an admin starts, by hand, to win back the disk run folders
 * take. It is never scheduled. A dry run (`plan`) lists what would go, per category, and keeps
 * that list under an id; `apply` confirms it, and removes only what the list holds that is
 * still eligible as things stand then. What came to be needed since is kept and counted.
 *
 * What it removes, in this order (see `RunCleanupCategory`):
 *
 *   1. In a finished module run: the media its assembly was staged with (`media/`), and the
 *      packages its agent installed itself (`module/node_modules` as a real folder; a link to
 *      the shared module packages is left as it is).
 *   2. The folders of finished runs beyond the newest `keepNewest` of their activity and kind.
 *      The newest succeeded run of each kind is kept as well, however many failed after it.
 *   3. Only when asked for: takes nobody accepted (`candidates/<runId>.<ext>` in a ref's media
 *      folder) of runs this server does not have, in the managed WAF checkout's media. That is
 *      a run of a deleted project or activity, and also one this server never had: a take a
 *      git pull or Loom brought counts as well.
 *
 * What it never removes, of an activity's runs:
 *
 * - a run still running, and a run whose Session is still working (a user can go on talking to
 *   a run's Session from the chat after the run finished);
 * - the module build the preview plays (the pinned one, while it is a succeeded build), the
 *   newest succeeded build, which a deploy ships, the pinned run whatever it is, a run a live
 *   play link plays, and every module run while a deploy of the activity is running;
 * - a repair's sources: the build and test run every repair round started from, and a build a
 *   finished test run played while it is still of the current draft, with that test run, since
 *   a repair round may yet start from them;
 * - a run the outcome ledger points at: one the draft's parts came from, or one credited with a
 *   deploy;
 * - the whole folder of a run whose folder is what it made or what goes on: test and quality
 *   runs (their reports), compositions (the page and images a recording plays), recordings,
 *   timeline renders, and conversations (an assist run holds the proposal and its thread,
 *   which the conversation panel can resume whenever);
 * - anything at all of an activity whose draft cannot be read (an archived one, or one whose
 *   files are not there): its runs are counted in `unreadActivities` instead.
 *
 * A link is never followed, neither to count its bytes nor to remove what it points to. A folder
 * or file that cannot be removed is left in place and the server log names it.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Component, Interface, Use } from "@waterford/waf-harness-core/kernel";
import type { Config, Log } from "../hmr/capabilities.js";
import { HttpError } from "../http/errors.js";
import type { ActivityAuthoring } from "../mechanisms/activities.js";
import type { Sessions } from "../runtime/session-manager.js";
import type { ActivityLock } from "./activity-lock.js";
import type { ActivityDeploys } from "./deploy-service.js";
import type { ActivityDraft, ActivityRunKind, ActivityRunSummary } from "./domain.js";
import { playingBuild } from "./module-builds.js";
import type { ActivityOutcomes } from "./outcomes.js";
import type { ActivityPlayLinks } from "./play-links.js";
import {
  RUN_CLEANUP_KEEP_MAX,
  RUN_CLEANUP_KEEP_MIN,
  RUN_CLEANUP_PLAN_TTL_MS,
  type RunCleanupCategory,
  type RunCleanupOptions,
  type RunCleanupPlan,
  type RunCleanupReport,
  type RunStorage,
} from "./run-cleanup-types.js";
import { realFolder, runsRoot, type ActivityRuns } from "./run-store.js";
import type { ActivitySandbox } from "./sandbox-service.js";
import type { WafWorkspace } from "./waf-workspace.js";

export abstract class ActivityRunCleanup extends Interface<{
  /** The disk every run folder takes together. */
  storage(): Promise<RunStorage>;
  /** What a cleanup with these options would remove, removing nothing; `apply` confirms it. */
  plan(options: RunCleanupOptions): Promise<RunCleanupPlan>;
  /**
   * Removes what the dry run `planId` listed that is still eligible now, and nothing it did not
   * list, and answers what it removed. A dry run is confirmed once: 409
   * `run_cleanup_plan_expired` for one already confirmed, expired, or made before a restart.
   */
  apply(planId: string): Promise<RunCleanupReport>;
}>() {}

/** What the cleanup asks of the work going on elsewhere in the server; a test stands in its own. */
export abstract class RunCleanupPorts extends Interface<{
  /** Whether a Session is working: a turn running, or background tasks of its own going on. */
  sessionBusy(sessionId: string): boolean;
  /** Whether a deploy of the activity is running: it copies the newest build as it goes. */
  deploying(projectId: string, activityId: string): Promise<boolean>;
}>() {}

@Component()
export class DefaultRunCleanupPorts implements RunCleanupPorts {
  @Use() private readonly sessions!: Sessions;
  @Use() private readonly deploys!: ActivityDeploys;

  sessionBusy(sessionId: string): boolean {
    return (
      this.sessions.statusOf(sessionId) !== "idle" ||
      this.sessions.backgroundTasksOf(sessionId) !== undefined
    );
  }

  deploying(projectId: string, activityId: string): Promise<boolean> {
    // Deploys that cannot be read are taken to be running, so no build is taken from under one.
    return this.deploys.latest(projectId, activityId).then(
      (run) => run?.status === "running",
      () => true,
    );
  }
}

/** Kinds whose folder is what they made or what goes on, kept whole however old. */
const KEPT_WHOLE: ReadonlySet<ActivityRunKind> = new Set([
  "test",
  "quality",
  "composition",
  "video",
  "timeline",
  "assist",
]);

/** What a module run is staged with that nothing reads once it has finished. */
const STAGED_ENTRIES = ["media", "module/node_modules"] as const;

/** A take's file name in a ref's `candidates/`. */
const TAKE_FILE = /^(run_[a-f0-9]{32})\.[A-Za-z0-9]+$/;

/** The most dry runs waiting for a confirmation at once; the oldest goes first. */
const PLANS_KEPT = 10;

type DraftView = Pick<ActivityDraft, "pinnedModuleRunId" | "contentRevision">;

/** What keeps one activity's runs whatever their age, besides what the draft and runs say. */
export interface Held {
  /** Runs live play links play. */
  live: ReadonlySet<string>;
  /** Runs the outcome ledger points at. */
  ledger: ReadonlySet<string>;
  /** Whether a run's Session is still working. */
  sessionBusy(sessionId: string): boolean;
  /** A deploy of the activity is running, so none of its module runs goes. */
  deploying: boolean;
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
    if (
      run.status === "running" ||
      held.live.has(run.runId) ||
      held.ledger.has(run.runId) ||
      (held.deploying && run.kind === "module") ||
      (run.sessionId !== null && held.sessionBusy(run.sessionId))
    )
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
  const loom = await realFolder(mediaDir, "loom");
  if (!loom) return found;
  for (const product of await folders(loom))
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

/** One thing a dry run listed, and its bytes as they were counted then. */
interface Listed {
  category: RunCleanupCategory;
  bytes: number;
}

/** A dry run waiting for its confirmation, its items keyed as `itemKey` names them. */
interface Plan {
  options: RunCleanupOptions;
  items: ReadonlyMap<string, Listed>;
  expiresAt: number;
}

const itemKey = {
  run: (runId: string) => `run:${runId}`,
  staged: (runId: string, entry: string) => `staged:${runId}/${entry}`,
  take: (file: string) => `take:${file}`,
};

@Component()
export class ActivityRunCleanupService implements ActivityRunCleanup {
  @Use() private readonly runs!: ActivityRuns;
  @Use() private readonly activities!: ActivityAuthoring;
  @Use() private readonly lock!: ActivityLock;
  @Use() private readonly links!: ActivityPlayLinks;
  @Use() private readonly outcomes!: ActivityOutcomes;
  @Use() private readonly wafWorkspace!: WafWorkspace;
  @Use() private readonly sandbox!: ActivitySandbox;
  @Use() private readonly ports!: RunCleanupPorts;
  @Use() private readonly config!: Config;
  @Use() private readonly log!: Log;

  /** One cleanup or dry run at a time, so two never count or remove the same folder. */
  private queue: Promise<unknown> = Promise.resolve();
  /** Dry runs not confirmed yet, by id, oldest first; per process. */
  private readonly plans = new Map<string, Plan>();

  async storage(): Promise<RunStorage> {
    const root = runsRoot(this.config.root);
    const all = await folders(root);
    const sizes = await Promise.all(all.map((folder) => treeBytes(folder)));
    return {
      bytes: sizes.reduce<number>((total, size) => total + (size ?? 0), 0),
      folders: all.length,
    };
  }

  plan(options: RunCleanupOptions): Promise<RunCleanupPlan> {
    const checked = checkOptions(options);
    return this.serial(async () => {
      const items = new Map<string, Listed>();
      const report = await this.cleanUp(checked, { listing: items });
      const planId = randomBytes(16).toString("hex");
      const expiresAt = Date.now() + RUN_CLEANUP_PLAN_TTL_MS;
      this.forgetExpired();
      this.plans.set(planId, { options: checked, items, expiresAt });
      for (const id of [...this.plans.keys()].slice(0, -PLANS_KEPT)) this.plans.delete(id);
      return { ...report, planId, expiresAt };
    });
  }

  apply(planId: string): Promise<RunCleanupReport> {
    return this.serial(async () => {
      this.forgetExpired();
      const plan = this.plans.get(planId);
      if (!plan)
        throw new HttpError(
          409,
          "run_cleanup_plan_expired",
          "That dry run can no longer be confirmed. Find what can be removed again.",
        );
      this.plans.delete(planId);
      return this.cleanUp(plan.options, { confirming: plan.items });
    });
  }

  private forgetExpired() {
    const now = Date.now();
    for (const [id, plan] of this.plans) if (now >= plan.expiresAt) this.plans.delete(id);
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => {}).then(work);
    this.queue = next;
    return next;
  }

  /**
   * A dry run, which counts what is eligible and lists it in `listing`; or the confirmation of
   * one, which removes what is both eligible now and in `confirming`, counted by the bytes listed.
   */
  private async cleanUp(
    options: RunCleanupOptions,
    mode: { listing: Map<string, Listed> } | { confirming: ReadonlyMap<string, Listed> },
  ): Promise<RunCleanupReport> {
    const listing = "listing" in mode ? mode.listing : null;
    const confirming = "confirming" in mode ? mode.confirming : null;
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
    // What a confirmation tried to remove; the rest of its dry run was kept.
    let attempted = 0;

    // Read before anything goes: a ledger that cannot be read ends the cleanup here, untouched.
    const ledger = new Set(await this.outcomes.heldRuns());
    const liveAtStart = this.links.liveRunIds();

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
        const chosen = chooseRuns(
          this.runs.summaries(projectId, activityId),
          draft,
          {
            live: new Set([...liveAtStart, ...this.links.liveRunIds()]),
            ledger,
            sessionBusy: (sessionId) => this.ports.sessionBusy(sessionId),
            deploying: await this.ports.deploying(projectId, activityId),
          },
          options.keepNewest,
        );

        if (listing) {
          for (const run of chosen.olderRuns) {
            const bytes = await treeBytes(this.runs.workspace(run.runId));
            if (bytes === null) continue;
            listing.set(itemKey.run(run.runId), { category: "olderRuns", bytes });
            count("olderRuns", bytes);
          }
          for (const run of chosen.stagedCopies)
            for (const entry of STAGED_ENTRIES) {
              const folder = await realFolder(this.runs.workspace(run.runId), entry);
              const bytes = folder === null ? null : await treeBytes(folder);
              if (bytes === null) continue;
              listing.set(itemKey.staged(run.runId, entry), { category: "stagedCopies", bytes });
              count("stagedCopies", bytes);
            }
          return;
        }

        const listed = confirming!;
        const older = chosen.olderRuns.flatMap((run) => {
          const item = listed.get(itemKey.run(run.runId));
          return item ? [{ runId: run.runId, bytes: item.bytes }] : [];
        });
        attempted += older.length;
        const left = new Set(await this.runs.removeWorkspaces(older.map(({ runId }) => runId)));
        const removed = older.filter(({ runId }) => !left.has(runId));
        for (const { bytes } of removed) count("olderRuns", bytes);
        failed += left.size;
        this.sandbox.forgetRuns(removed.map(({ runId }) => runId));

        for (const run of chosen.stagedCopies)
          for (const entry of STAGED_ENTRIES) {
            const item = listed.get(itemKey.staged(run.runId, entry));
            if (!item) continue;
            attempted += 1;
            if (await this.runs.removeFromWorkspace(run.runId, entry))
              count("stagedCopies", item.bytes);
            else failed += 1;
          }
      };
      if (confirming) await this.lock.run(activityId, work);
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
          const key = itemKey.take(take.file);
          if (listing) {
            listing.set(key, { category: "orphanTakes", bytes: take.bytes });
            count("orphanTakes", take.bytes);
            continue;
          }
          const item = confirming!.get(key);
          if (!item) continue;
          attempted += 1;
          try {
            await fs.rm(take.file, { force: true });
            count("orphanTakes", item.bytes);
          } catch (error) {
            const code = (error as NodeJS.ErrnoException).code ?? String(error);
            this.log.line(`[activities] A take was left in place (${code}): ${take.file}`);
            failed += 1;
          }
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
      keptSincePlan: confirming ? confirming.size - attempted : 0,
    };
  }
}
