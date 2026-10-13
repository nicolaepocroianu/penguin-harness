/**
 * The outcome ledger: each activity run's recipe, and what became of the run after it ended.
 *
 * The ledger is shown how a run or a draft stands at a few moments (`witness`): a run as it opens,
 * as its agent starts working and as it ends, an assist run as its proposal is discarded, and a
 * draft each time it changes. Everything else it works out itself:
 *
 * - the recipe, fixed as the run's agent starts working (or as the run opens, when no agent works
 *   it): who answered, the bundled skills and helpers its workspace was given (matched by digest
 *   against the bundled library), the harness of a module or test run, and Penguin's version. The
 *   prompt's digest and the build's commit are kept beside it, not in it: a prompt embeds its
 *   inputs, and every commit would otherwise be a recipe of its own;
 * - what a run's checks found, read from its record and its folder once, as it ends (a later
 *   change to the folder changes nothing), and which module build a test or quality run judged;
 * - a later run of the same target superseding an earlier one;
 * - how each part of a draft changed (an accepted candidate, an amendment by a run of another
 *   kind, an edit or a return to an earlier version, by digest and size, never by text), which
 *   run's work it changed, and who changed it: the ambient cause an author's route, the Stages or
 *   a run applying its own result runs its work under (`attribute`). A change no cause owns
 *   counts as unattributed, never as an author's edit; an amendment counts as a run's edit;
 * - which runs reached a deploy: the module build it shipped, and every run whose parts the
 *   deployed draft holds.
 *
 * A run the ledger first sees as it ends started before the ledger: its recipe is unknown, and
 * tallies leave it out. Nothing the ledger does throws into its callers; a moment it cannot record
 * is logged and dropped.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { buildInfo } from "@prismshadow/penguin-core";
import { Component, Interface, Use, type ClassCtx } from "@prismshadow/penguin-core/kernel";
import type { Db, Log } from "../hmr/capabilities.js";
import { DISCARDED_PROPOSAL_FILE } from "./assist.js";
import type { ActivityDeployEvents } from "./deploy-events.js";
import type { DeployedEvent } from "./deploy-types.js";
import type { ActivityDraft, ActivityRun } from "./domain.js";
import { playingBuild } from "./module-builds.js";
import { checkMetrics, targetOf, type Metrics } from "./outcome-checks.js";
import { changedBytes, draftParts } from "./outcome-parts.js";
import { bundledLibrary, recipeId, recipeOf, runtimeOf, sha256 } from "./outcome-recipe.js";
import type {
  LibraryFile,
  OutcomeCause,
  OutcomeDimension,
  OutcomeFact,
  OutcomeFactName,
  OutcomeQuery,
  OutcomeRun,
  OutcomeRunsQuery,
  OutcomeTally,
  RunRecipe,
  RunStory,
  Witnessed,
} from "./outcome-types.js";
import type { ActivityRuns } from "./run-store.js";

export type {
  OutcomeCause,
  OutcomeQuery,
  OutcomeTally,
  RunRecipe,
  RunStory,
  Witnessed,
} from "./outcome-types.js";

/** What the ledger reads of the host; a test stands in its own. */
export abstract class ActivityOutcomePorts extends Interface<{
  /** The bundled files a run may be given; the shipped authoring plugins' by default. */
  library?: () => LibraryFile[];
  /** Penguin's version, and the commit it was built from when known; this build's by default. */
  build?: () => { penguin: string; commit: string | null };
}>() {}

@Component()
export class DefaultActivityOutcomePorts implements ActivityOutcomePorts {}

export abstract class ActivityOutcomes extends Interface<{
  /** How a run or the draft stands now. Synchronous; never throws; keeps only what changed. */
  witness(moment: Witnessed): void;
  /**
   * Runs `operation`; the draft changes witnessed inside it, and the runs opened inside it, belong
   * to `cause`. Causes nest, the inner one winning field by field: an accept inside an
   * author's request names its run and keeps the author.
   */
  attribute<T>(cause: OutcomeCause, operation: () => Promise<T>): Promise<T>;
  /**
   * Counts for one run kind, per recipe or per part of one; runs whose recipe is unknown are left
   * out. Largest first.
   */
  tally(query: OutcomeQuery): Promise<OutcomeTally[]>;
  /** One activity's runs (or one run), oldest first, each with its recipe and its facts. */
  history(projectId: string, activityId: string, runId?: string): Promise<RunStory[]>;
  /**
   * The runs one tally counted (the tally's query, and its key), newest first and at most
   * `RUNS_LISTED` of them: what an admin opens a tally on.
   */
  tallyRuns(query: OutcomeRunsQuery): Promise<OutcomeRun[]>;
  /** The projects the ledger holds runs of, by id, in order. */
  projects(): Promise<string[]>;
}>() {}

/** The most runs one tally lists. */
export const RUNS_LISTED = 50;

interface OutcomeRow {
  run_id: string;
  project_id: string;
  activity_id: string;
  kind: ActivityRun["kind"];
  target: string | null;
  recipe_id: string | null;
  prompt_sha256: string | null;
  started_at: string;
  settled_at: string | null;
  status: string;
  accepted_by: string | null;
  metrics_json: string;
}

interface PartRow {
  part: string;
  run_id: string | null;
  sha256: string;
}

/** What a part fact records: digests, sizes and run ids. */
interface PartChange {
  part: string;
  change: "accept" | "amend" | "edit" | "revert";
  /** Who made the change: the cause's actor, or `unattributed` with none. */
  actor: string;
  from: string | null;
  to: string | null;
  size: number;
  bytes: number;
  revision: string;
  /** The run the part came from before the change, and after it. */
  fromRun: string | null;
  run: string | null;
  /** The run of another kind that amended the part, which stays the run's it was. */
  amendedBy?: string;
}

/** The kinds whose report judges a module build, by the prefix their numbers have. */
const JUDGES: Partial<Record<ActivityRun["kind"], readonly string[]>> = {
  test: ["tests."],
  quality: ["accessibility.", "readability."],
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What a tally groups a run under: its recipe's id, or the value of one part of the recipe. */
function dimensionKey(
  by: OutcomeDimension,
  row: Pick<OutcomeRow, "recipe_id" | "prompt_sha256">,
  recipe: RunRecipe,
): string | null {
  switch (by) {
    case "recipe":
      return row.recipe_id;
    case "runtime":
      return recipe.runtime;
    case "prompt":
      return row.prompt_sha256;
    case "library":
      return recipeId({ runtime: "", library: recipe.library, penguin: "" });
    case "harness":
      return recipe.harness === undefined ? null : String(recipe.harness);
    case "penguin":
      return recipe.penguin;
  }
}

function seconds(from: string, to: string | null): number | null {
  if (!to) return null;
  const elapsed = (Date.parse(to) - Date.parse(from)) / 1000;
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
}

@Component()
export class ActivityOutcomeLedger implements ActivityOutcomes {
  @Use() private readonly db!: Db;
  @Use() private readonly runs!: ActivityRuns;
  @Use() private readonly deployEvents!: ActivityDeployEvents;
  @Use() private readonly ports!: ActivityOutcomePorts;
  @Use() private readonly log!: Log;
  /** The cause the work running now belongs to, as `attribute` set it. */
  private readonly causes = new AsyncLocalStorage<OutcomeCause>();

  setup({ effect }: ClassCtx) {
    const listener = (event: DeployedEvent) =>
      this.record(`the ${event.target} deploy of ${event.activityId}`, () => this.deployed(event));
    this.deployEvents.subscribe(listener);
    effect(() => this.deployEvents.unsubscribe(listener));
  }

  witness(moment: Witnessed): void {
    if ("draft" in moment)
      this.record(`the draft of ${moment.draft.activityId}`, () => this.draftChanged(moment.draft));
    else this.record(`run ${moment.run.runId}`, () => this.runMoment(moment));
  }

  attribute<T>(cause: OutcomeCause, operation: () => Promise<T>): Promise<T> {
    const inner = Object.fromEntries(
      Object.entries(cause).filter(([, value]) => value !== undefined),
    ) as OutcomeCause;
    return this.causes.run({ ...this.causes.getStore(), ...inner }, operation);
  }

  async tally(query: OutcomeQuery): Promise<OutcomeTally[]> {
    try {
      return this.tallied(query);
    } catch (error) {
      this.log.line(`[activity-outcomes] could not tally ${query.kind} runs: ${messageOf(error)}`);
      return [];
    }
  }

  async history(projectId: string, activityId: string, runId?: string): Promise<RunStory[]> {
    try {
      return this.stories(projectId, activityId, runId);
    } catch (error) {
      this.log.line(`[activity-outcomes] could not read ${activityId}'s runs: ${messageOf(error)}`);
      return [];
    }
  }

  async tallyRuns(query: OutcomeRunsQuery): Promise<OutcomeRun[]> {
    try {
      const by = query.by ?? "recipe";
      return this.counted(query)
        .filter(({ row, recipe }) => dimensionKey(by, row, recipe) === query.key)
        .sort((a, b) => b.row.started_at.localeCompare(a.row.started_at))
        .slice(0, RUNS_LISTED)
        .map(({ row }) => ({
          runId: row.run_id,
          projectId: row.project_id,
          activityId: row.activity_id,
          startedAt: row.started_at,
          status: row.status as ActivityRun["status"],
        }));
    } catch (error) {
      this.log.line(`[activity-outcomes] could not list ${query.kind} runs: ${messageOf(error)}`);
      return [];
    }
  }

  async projects(): Promise<string[]> {
    try {
      return (
        this.db
          .prepare("SELECT DISTINCT project_id FROM activity_run_outcomes ORDER BY project_id")
          .all() as { project_id: string }[]
      ).map((row) => row.project_id);
    } catch (error) {
      this.log.line(`[activity-outcomes] could not list projects: ${messageOf(error)}`);
      return [];
    }
  }

  /** Writes what one moment changed, all of it or none; a failure is logged, never thrown. */
  private record(what: string, write: () => void): void {
    try {
      this.db.exec("SAVEPOINT activity_outcomes");
      try {
        write();
        this.db.exec("RELEASE activity_outcomes");
      } catch (error) {
        this.db.exec("ROLLBACK TO activity_outcomes");
        this.db.exec("RELEASE activity_outcomes");
        throw error;
      }
    } catch (error) {
      this.log.line(`[activity-outcomes] could not record ${what}: ${messageOf(error)}`);
    }
  }

  private library(): LibraryFile[] {
    return this.ports.library?.() ?? bundledLibrary();
  }

  private build(): { penguin: string; commit: string | null } {
    if (this.ports.build) return this.ports.build();
    const info = buildInfo();
    return { penguin: info.version, commit: info.commit };
  }

  // ---- runs ----

  private runMoment(moment: Extract<Witnessed, { run: ActivityRun }>): void {
    const { run } = moment;
    let row = this.row(run.runId);
    if (!row) {
      // First seen as it ends: it started before the ledger, so what made it is unknown, and
      // tallies leave it out. A permanent tolerance, since no recipe can be recovered: it could
      // go only once no project holds a run started before migration 25.
      if (run.status === "running") this.opened(run);
      else this.insertRow(run, null);
      row = this.row(run.runId)!;
    }
    if ((moment.session || moment.server) && row.recipe_id === null && this.opening(run.runId))
      this.started(run, moment);
    if (run.status !== "running" && row.settled_at === null) this.settled(run);
    if (run.kind === "assist") this.discarded(run);
  }

  private row(runId: string): OutcomeRow | undefined {
    return this.db.prepare("SELECT * FROM activity_run_outcomes WHERE run_id = ?").get(runId) as
      OutcomeRow | undefined;
  }

  /** Whether the ledger saw the run open, and so may fix its recipe. */
  private opening(runId: string): boolean {
    return !!this.db
      .prepare("SELECT 1 FROM activity_outcome_facts WHERE run_id = ? AND fact = 'opened'")
      .get(runId);
  }

  private insertRow(run: ActivityRun, recipe: { id: string; commit: string | null } | null): void {
    this.db
      .prepare(
        `INSERT INTO activity_run_outcomes (run_id, project_id, activity_id, kind, target, recipe_id,
           build, started_at, status, metrics_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')`,
      )
      .run(
        run.runId,
        run.projectId,
        run.activityId,
        run.kind,
        targetOf(run),
        recipe?.id ?? null,
        recipe?.commit ?? null,
        run.createdAt,
        run.status,
      );
  }

  private fact(
    run: Pick<ActivityRun, "projectId" | "activityId"> & { runId: string | null },
    fact: OutcomeFactName,
    at: string,
    detail: Record<string, unknown> = {},
  ): void {
    this.db
      .prepare(
        "INSERT INTO activity_outcome_facts (project_id, activity_id, run_id, fact, at, detail_json) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(run.projectId, run.activityId, run.runId, fact, at, JSON.stringify(detail));
  }

  private metrics(runId: string): Metrics {
    const row = this.row(runId);
    return row ? (JSON.parse(row.metrics_json) as Metrics) : {};
  }

  private saveMetrics(runId: string, metrics: Metrics): void {
    this.db
      .prepare("UPDATE activity_run_outcomes SET metrics_json = ? WHERE run_id = ?")
      .run(JSON.stringify(metrics), runId);
  }

  private count(runId: string, name: string, by = 1): void {
    const metrics = this.metrics(runId);
    metrics[name] = (metrics[name] ?? 0) + by;
    this.saveMetrics(runId, metrics);
  }

  /** Keeps a recipe once, and answers its id. */
  private keepRecipe(run: ActivityRun, runtime: string): { id: string; commit: string | null } {
    const build = this.build();
    const recipe = recipeOf(
      run,
      runtime,
      this.runs.workspace(run.runId),
      this.library(),
      build.penguin,
    );
    const id = recipeId(recipe);
    this.db
      .prepare(
        "INSERT OR IGNORE INTO activity_outcome_recipes (recipe_id, recipe_json, first_seen_at) VALUES (?, ?, ?)",
      )
      .run(id, JSON.stringify(recipe), run.createdAt);
    return { id, commit: build.commit };
  }

  private opened(run: ActivityRun): void {
    // Work no agent has a part in is the server's from the start.
    this.insertRow(run, run.agentId === "" ? this.keepRecipe(run, "server") : null);
    const target = targetOf(run);
    const judges = JUDGES[run.kind] ? this.judgedBuild(run) : null;
    // Who started it: an author's request or the Stages. A run the Stages start may apply its
    // own result later, under its own cause; this is what ties that back to them.
    const by = this.causes.getStore()?.actor;
    if (by) this.saveMetrics(run.runId, { [`startedBy.${by}`]: 1 });
    this.fact(run, "opened", run.createdAt, {
      ...(target !== null ? { target } : {}),
      ...(judges ? { judges } : {}),
      ...(by ? { by } : {}),
    });
    // A conversation is never done again; every other kind's later run replaces what it made.
    if (run.kind === "assist") return;
    const earlier = this.db
      .prepare(
        `SELECT run_id, metrics_json FROM activity_run_outcomes
          WHERE activity_id = ? AND kind = ? AND target IS ? AND run_id != ?`,
      )
      .all(run.activityId, run.kind, target, run.runId) as Pick<
      OutcomeRow,
      "run_id" | "metrics_json"
    >[];
    for (const row of earlier) {
      const metrics = JSON.parse(row.metrics_json) as Metrics;
      if (metrics.superseded) continue;
      this.saveMetrics(row.run_id, { ...metrics, superseded: 1 });
      this.fact({ ...run, runId: row.run_id }, "superseded", run.createdAt, { by: run.runId });
    }
  }

  /**
   * The module build a test or quality run plays: the one a test run names; else the one the
   * preview plays when the run opens, which is the pin the ledger last saw on the draft while it
   * is a succeeded build, else the newest.
   */
  private judgedBuild(run: ActivityRun): string | null {
    // A test run names the build it played.
    if (run.test?.moduleRunId) return run.test.moduleRunId;
    const builds = this.runs.summaries(run.projectId, run.activityId, {
      kind: "module",
      status: "succeeded",
    });
    const pinned = this.db
      .prepare(
        `SELECT detail_json FROM activity_outcome_facts
          WHERE activity_id = ? AND fact = 'pinned' ORDER BY seq DESC LIMIT 1`,
      )
      .get(run.activityId) as { detail_json: string } | undefined;
    const pin = pinned ? (JSON.parse(pinned.detail_json) as { runId?: string }).runId : undefined;
    return playingBuild(builds, pin)?.runId ?? null;
  }

  private started(
    run: ActivityRun,
    moment: Pick<Extract<Witnessed, { run: ActivityRun }>, "prompt" | "session" | "server">,
  ): void {
    const runtime = runtimeOf(moment.session, moment.server);
    const recipe = this.keepRecipe(run, runtime);
    const prompt = moment.prompt !== undefined ? sha256(moment.prompt) : null;
    this.db
      .prepare(
        "UPDATE activity_run_outcomes SET recipe_id = ?, prompt_sha256 = ?, build = ? WHERE run_id = ?",
      )
      .run(recipe.id, prompt, recipe.commit, run.runId);
    this.fact(run, "started", run.createdAt, { runtime, ...(prompt ? { prompt } : {}) });
  }

  private settled(run: ActivityRun): void {
    const at = run.finishedAt ?? run.createdAt;
    const checks = checkMetrics(run, this.runs.workspace(run.runId));
    this.db
      .prepare(
        "UPDATE activity_run_outcomes SET status = ?, settled_at = ?, metrics_json = ? WHERE run_id = ?",
      )
      .run(run.status, at, JSON.stringify({ ...this.metrics(run.runId), ...checks }), run.runId);
    this.fact(run, "settled", at, { status: run.status });
    if (Object.keys(checks).length) this.fact(run, "checks", at, checks);
    const prefixes = JUDGES[run.kind];
    if (prefixes && run.status === "succeeded") this.judged(run, at, checks, prefixes);
  }

  /** Credits a test or quality run's numbers to the module build it played; the latest wins. */
  private judged(run: ActivityRun, at: string, checks: Metrics, prefixes: readonly string[]): void {
    const opened = this.db
      .prepare(
        "SELECT detail_json FROM activity_outcome_facts WHERE run_id = ? AND fact = 'opened'",
      )
      .get(run.runId) as { detail_json: string } | undefined;
    const build = opened ? (JSON.parse(opened.detail_json) as { judges?: string }).judges : null;
    if (!build || !this.row(build)) return;
    const kept = Object.fromEntries(
      Object.entries(this.metrics(build)).filter(
        ([name]) => !prefixes.some((prefix) => name.startsWith(`judged.${prefix}`)),
      ),
    );
    const judged = Object.fromEntries(
      Object.entries(checks).map(([name, value]) => [`judged.${name}`, value]),
    );
    this.saveMetrics(build, { ...kept, ...judged });
    this.fact({ ...run, runId: build }, "judged", at, { by: run.runId, kind: run.kind, ...checks });
  }

  /** An assist run's proposal discarded: counted once each time its file is renamed again. */
  private discarded(run: ActivityRun): void {
    const file = path.join(this.runs.workspace(run.runId), DISCARDED_PROPOSAL_FILE);
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    if (!stat) return;
    const at = stat.mtime.toISOString();
    const last = this.db
      .prepare(
        "SELECT at FROM activity_outcome_facts WHERE run_id = ? AND fact = 'discarded' ORDER BY seq DESC LIMIT 1",
      )
      .get(run.runId) as { at: string } | undefined;
    if (last && last.at >= at) return;
    this.count(run.runId, "discarded");
    this.fact(run, "discarded", at);
  }

  // ---- drafts ----

  private draftChanged(change: {
    projectId: string;
    activityId: string;
    before: ActivityDraft;
    after: ActivityDraft;
  }): void {
    const { projectId, activityId, before, after } = change;
    const cause = this.causes.getStore();
    // No cause names who made it: it counts as unattributed, never as an author's edit.
    const actor = cause?.actor ?? "unattributed";
    // A change under a run's cause accepts that run's candidate, when it is a run of this activity.
    const accepting = cause?.runId ? this.runs.get(projectId, activityId, cause.runId) : null;
    const parts = this.partsBefore(activityId, before);
    const was = draftParts(before);
    const now = draftParts(after);
    for (const part of [...new Set([...was.keys(), ...now.keys()])].sort()) {
      const old = was.get(part);
      const next = now.get(part);
      const from = old ? sha256(old) : null;
      const to = next ? sha256(next) : null;
      if (from === to) continue;
      const fromRun = parts.get(part)?.run_id ?? null;
      // An edit keeps the part the run's it was; a return to an earlier version gives it back to
      // the run it came from then.
      let kind: PartChange["change"] = "edit";
      let run = fromRun;
      const owner = fromRun ? this.runs.get(projectId, activityId, fromRun) : null;
      if (accepting && owner && owner.runId !== accepting.runId && owner.kind !== accepting.kind)
        // A run of another kind amending the part (the media pass over the specification) edits
        // what the run that made it made; it does not take the part over.
        kind = "amend";
      else if (accepting) {
        kind = "accept";
        run = accepting.runId;
      } else if (to) {
        const earlier = this.earlierProvenance(activityId, part, to);
        if (earlier !== undefined) {
          kind = "revert";
          run = earlier;
        }
      }
      const changed: PartChange = {
        part,
        change: kind,
        actor,
        from,
        to,
        size: next?.length ?? 0,
        bytes: changedBytes(old ?? Buffer.alloc(0), next ?? Buffer.alloc(0)),
        revision: after.contentRevision,
        fromRun,
        run,
        ...(kind === "amend" && accepting ? { amendedBy: accepting.runId } : {}),
      };
      this.fact(
        { projectId, activityId, runId: accepting?.runId ?? fromRun },
        "part",
        after.updatedAt,
        { ...changed },
      );
      if (fromRun && fromRun !== changed.run && this.row(fromRun))
        // Its work was replaced by another run's, or taken back to what was there before it.
        this.count(fromRun, changed.change === "accept" ? "replaced" : "reverted");
      if ((kind === "edit" || kind === "amend") && fromRun && this.row(fromRun)) {
        // An amendment is a later run's edit, whoever applied it.
        const by = kind === "amend" ? "run" : actor;
        this.count(fromRun, `edits.${by}`);
        this.count(fromRun, `editedBytes.${by}`, changed.bytes);
      }
      if (to === null)
        this.db
          .prepare("DELETE FROM activity_draft_parts WHERE activity_id = ? AND part = ?")
          .run(activityId, part);
      else this.putPart(activityId, part, changed.run, to, changed.size, after.updatedAt);
    }
    if (accepting)
      this.accepted(accepting.runId, { projectId, activityId }, cause?.actor, after.updatedAt);
    const pin = (draft: ActivityDraft) => draft.pinnedModuleRunId ?? null;
    if (pin(before) !== pin(after))
      this.fact({ projectId, activityId, runId: null }, "pinned", after.updatedAt, {
        runId: pin(after),
      });
  }

  /**
   * A run's candidate became part of the draft: who accepted it, and when, kept the first time.
   * With no actor named, whoever started the run accepted it, else the run itself.
   */
  private accepted(
    runId: string,
    activity: { projectId: string; activityId: string },
    named: OutcomeCause["actor"],
    at: string,
  ): void {
    const row = this.row(runId);
    if (!row || row.accepted_by !== null) return;
    const actor = named ?? this.startedBy(row) ?? "run";
    this.db
      .prepare("UPDATE activity_run_outcomes SET accepted_by = ?, accepted_at = ? WHERE run_id = ?")
      .run(actor, at, runId);
    this.fact({ ...activity, runId }, "accepted", at, { actor });
  }

  /** Who started a run, as it opened; undefined when no cause named anyone. */
  private startedBy(row: OutcomeRow): string | undefined {
    const name = Object.keys(JSON.parse(row.metrics_json) as Metrics).find((key) =>
      key.startsWith("startedBy."),
    );
    return name?.slice("startedBy.".length);
  }

  private putPart(
    activityId: string,
    part: string,
    runId: string | null,
    sha: string,
    size: number,
    at: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO activity_draft_parts (activity_id, part, run_id, sha256, size, at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(activity_id, part) DO UPDATE SET run_id = excluded.run_id, sha256 = excluded.sha256,
           size = excluded.size, at = excluded.at`,
      )
      .run(activityId, part, runId, sha, size, at);
  }

  /**
   * The draft's parts as the ledger keeps them, brought to `before` first: a part written by
   * anything but a change (a new activity, a renumbered ref, an older draft moved into its
   * module) is nobody's edit, so its digest is taken as it is and the run it came from kept.
   */
  private partsBefore(activityId: string, before: ActivityDraft): Map<string, PartRow> {
    const kept = new Map(
      (
        this.db
          .prepare("SELECT part, run_id, sha256 FROM activity_draft_parts WHERE activity_id = ?")
          .all(activityId) as unknown as PartRow[]
      ).map((row) => [row.part, row]),
    );
    const current = draftParts(before);
    for (const part of kept.keys())
      if (!current.has(part)) {
        this.db
          .prepare("DELETE FROM activity_draft_parts WHERE activity_id = ? AND part = ?")
          .run(activityId, part);
        kept.delete(part);
      }
    for (const [part, bytes] of current) {
      const sha = sha256(bytes);
      const row = kept.get(part);
      if (row?.sha256 === sha) continue;
      const runId = row?.run_id ?? null;
      this.putPart(activityId, part, runId, sha, bytes.length, before.updatedAt);
      kept.set(part, { part, run_id: runId, sha256: sha });
    }
    return kept;
  }

  /**
   * Whether the part held this digest before, and if so the run it came from then: undefined
   * when it never did.
   */
  private earlierProvenance(
    activityId: string,
    part: string,
    sha: string,
  ): string | null | undefined {
    const row = this.db
      .prepare(
        `SELECT detail_json FROM activity_outcome_facts
          WHERE activity_id = ? AND fact = 'part'
            AND json_extract(detail_json, '$.part') = ? AND json_extract(detail_json, '$.from') = ?
          ORDER BY seq DESC LIMIT 1`,
      )
      .get(activityId, part, sha) as { detail_json: string } | undefined;
    return row ? ((JSON.parse(row.detail_json) as PartChange).fromRun ?? null) : undefined;
  }

  // ---- deploys ----

  /**
   * A deploy reached QA or PROD: the module build it shipped is credited, and so is every run
   * whose parts the deployed draft holds.
   */
  private deployed(event: DeployedEvent): void {
    const credited = new Map<string, "build" | "part">();
    if (event.moduleRunId && this.row(event.moduleRunId)?.activity_id === event.activityId)
      credited.set(event.moduleRunId, "build");
    for (const runId of this.liveRuns(event.activityId, event.revision))
      if (!credited.has(runId) && this.row(runId)) credited.set(runId, "part");
    for (const [runId, as] of credited) {
      this.saveMetrics(runId, { ...this.metrics(runId), [`deployed.${event.target}`]: 1 });
      this.fact(
        { projectId: event.projectId, activityId: event.activityId, runId },
        "deployed",
        event.deployedAt,
        { target: event.target, deploy: event.runId, as },
      );
    }
  }

  /**
   * The runs the draft's parts came from at a revision, replayed from the part facts; with no
   * revision, the parts as they are now. None when the ledger never saw that revision.
   */
  private liveRuns(activityId: string, revision: string | null): string[] {
    if (revision === null)
      return (
        this.db
          .prepare(
            "SELECT DISTINCT run_id FROM activity_draft_parts WHERE activity_id = ? AND run_id IS NOT NULL",
          )
          .all(activityId) as { run_id: string }[]
      ).map((row) => row.run_id);
    const changes = (
      this.db
        .prepare(
          "SELECT detail_json FROM activity_outcome_facts WHERE activity_id = ? AND fact = 'part' ORDER BY seq",
        )
        .all(activityId) as { detail_json: string }[]
    ).map((row) => JSON.parse(row.detail_json) as PartChange);
    const last = changes.findLastIndex((change) => change.revision === revision);
    // Each part's runs: the one it came from, and those of other kinds that amended it since.
    const runs = new Map<string, string[]>();
    for (const change of changes.slice(0, last + 1))
      if (change.to === null) runs.delete(change.part);
      else if (change.change === "amend" && change.amendedBy)
        runs.set(change.part, [...(runs.get(change.part) ?? []), change.amendedBy]);
      else if (change.change !== "edit" || !runs.has(change.part))
        runs.set(change.part, change.run ? [change.run] : []);
    return [...new Set([...runs.values()].flat())];
  }

  // ---- reads ----

  /** The runs a query counts, each with its recipe: those with an unknown recipe are left out. */
  private counted(query: OutcomeQuery): { row: OutcomeRow; recipe: RunRecipe }[] {
    const where = ["o.kind = ?"];
    const params: string[] = [query.kind];
    if (query.projectId !== undefined) {
      where.push("o.project_id = ?");
      params.push(query.projectId);
    }
    if (query.activityIds !== undefined) {
      if (!query.activityIds.length) return [];
      where.push(`o.activity_id IN (${query.activityIds.map(() => "?").join(", ")})`);
      params.push(...query.activityIds);
    }
    if (query.since !== undefined) {
      where.push("o.started_at >= ?");
      params.push(query.since);
    }
    if (query.until !== undefined) {
      where.push("o.started_at < ?");
      params.push(query.until);
    }
    const rows = this.db
      .prepare(
        `SELECT o.run_id, o.project_id, o.activity_id, o.recipe_id, o.prompt_sha256, o.status,
                o.started_at, o.settled_at, o.accepted_by, o.metrics_json,
                r.recipe_json
           FROM activity_run_outcomes o
           JOIN activity_outcome_recipes r ON r.recipe_id = o.recipe_id
          WHERE ${where.join(" AND ")}`,
      )
      .all(...params) as unknown as (OutcomeRow & { recipe_json: string })[];
    return rows.map((row) => ({ row, recipe: JSON.parse(row.recipe_json) as RunRecipe }));
  }

  private tallied(query: OutcomeQuery): OutcomeTally[] {
    const by = query.by ?? "recipe";
    const groups = new Map<string | null, OutcomeTally>();
    for (const { row, recipe } of this.counted(query)) {
      const key = dimensionKey(by, row, recipe);
      const tally = groups.get(key) ?? {
        key,
        recipe: by === "recipe" ? recipe : null,
        runs: 0,
        metrics: {},
      };
      tally.runs++;
      const add = (name: string, value: number) => {
        tally.metrics[name] = (tally.metrics[name] ?? 0) + value;
      };
      add(row.status, 1);
      if (row.accepted_by !== null) {
        add("accepted", 1);
        add(`accepted.${row.accepted_by}`, 1);
      }
      const took = seconds(row.started_at, row.settled_at);
      if (took !== null) add("seconds", took);
      for (const [name, value] of Object.entries(JSON.parse(row.metrics_json) as Metrics))
        add(name, value);
      groups.set(key, tally);
    }
    return [...groups.values()].sort(
      (a, b) => b.runs - a.runs || String(a.key).localeCompare(String(b.key)),
    );
  }

  private stories(projectId: string, activityId: string, runId?: string): RunStory[] {
    const rows = this.db
      .prepare(
        `SELECT o.run_id, o.activity_id, o.kind, o.started_at, r.recipe_json
           FROM activity_run_outcomes o
           LEFT JOIN activity_outcome_recipes r ON r.recipe_id = o.recipe_id
          WHERE o.project_id = ? AND o.activity_id = ?${runId !== undefined ? " AND o.run_id = ?" : ""}
          ORDER BY o.started_at, o.run_id`,
      )
      .all(projectId, activityId, ...(runId !== undefined ? [runId] : [])) as unknown as (Pick<
      OutcomeRow,
      "run_id" | "activity_id" | "kind" | "started_at"
    > & { recipe_json: string | null })[];
    const facts = new Map<string, OutcomeFact[]>();
    const recorded = this.db
      .prepare(
        `SELECT run_id, fact, at, detail_json FROM activity_outcome_facts
          WHERE activity_id = ? AND run_id IS NOT NULL${runId !== undefined ? " AND run_id = ?" : ""}
          ORDER BY seq`,
      )
      .all(activityId, ...(runId !== undefined ? [runId] : [])) as {
      run_id: string;
      fact: OutcomeFactName;
      at: string;
      detail_json: string;
    }[];
    for (const fact of recorded) {
      const list = facts.get(fact.run_id) ?? [];
      list.push({
        fact: fact.fact,
        at: fact.at,
        detail: JSON.parse(fact.detail_json) as Record<string, unknown>,
      });
      facts.set(fact.run_id, list);
    }
    return rows.map((row) => ({
      runId: row.run_id,
      activityId: row.activity_id,
      kind: row.kind,
      startedAt: row.started_at,
      recipe: row.recipe_json ? (JSON.parse(row.recipe_json) as RunRecipe) : null,
      facts: facts.get(row.run_id) ?? [],
    }));
  }
}
