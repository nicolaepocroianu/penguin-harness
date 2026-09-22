/**
 * Building a module on demand, once.
 *
 * Loom rebuilds inside a watch-mode dev server: a request arrives, `ensureModuleAssets`
 * checks freshness and rebuilds if the sources moved. This does the same thing without the
 * second server — but the part worth getting right is not the spawn, it is what happens
 * when four requests for the same preview arrive while a build is already running.
 *
 * So the build itself is injected. The coalescing, the freshness decision and the failure
 * reporting are ordinary code with tests; the child process is the caller's business.
 */
import { moduleStale } from "./sandbox-model.js";

export interface BuildAttempt {
  ok: boolean;
  /** When the build finished, in epoch milliseconds. */
  finishedAtMs: number;
  /** The build's own output, kept whole: a webpack failure is only readable in full. */
  log: string;
}

/** What a caller learns about a build it asked for. */
export interface BuildResult extends BuildAttempt {
  /** True when this request joined a build already running rather than starting one. */
  joined: boolean;
  /** True when nothing was built because the module was already current. */
  skipped: boolean;
}

export interface BuilderDeps {
  /** Runs the module's own build in this workspace. Rejecting counts as a failed build. */
  build(workspace: string): Promise<{ ok: boolean; log: string }>;
  /** Modification times of everything the build reads, newest first or in any order. */
  sources(workspace: string): Promise<number[]>;
  now(): number;
}

/**
 * One build per workspace at a time, with everyone waiting on the same one.
 *
 * Four scene edits in a row should not start four webpack builds. A request that arrives
 * while a build is running joins it — and is told it joined, because "your build finished"
 * and "someone else's build finished and it covered you" are different claims and only one
 * of them is true.
 */
export class SandboxBuilder {
  private readonly running = new Map<string, Promise<Omit<BuildResult, "joined">>>();
  private readonly lastBuild = new Map<string, BuildAttempt>();

  constructor(private readonly deps: BuilderDeps) {}

  /** When the workspace was last built here, or null if it has not been. */
  builtAtMs(workspace: string): number | null {
    const last = this.lastBuild.get(workspace);
    return last?.ok ? last.finishedAtMs : null;
  }

  /** The last build's output, for showing an author why their preview is not there. */
  lastLog(workspace: string): string | null {
    return this.lastBuild.get(workspace)?.log ?? null;
  }

  /**
   * Builds if the sources moved, joins work already in progress, and otherwise does
   * nothing.
   *
   * The in-flight entry is registered SYNCHRONOUSLY, before the freshness scan. It has to
   * be: the scan is async, so checking the map and then awaiting leaves a window in which
   * every concurrent caller sees an empty map and starts its own build — which is the one
   * failure this class exists to prevent. Found by its own test, which hung waiting for
   * three builds nobody had asked for.
   *
   * `force` rebuilds regardless — what a Play button does, because an author pressing it
   * after a build they believe failed is asking for a build, not a freshness opinion.
   */
  ensure(workspace: string, force = false): Promise<BuildResult> {
    const inFlight = this.running.get(workspace);
    if (inFlight) return inFlight.then((attempt) => ({ ...attempt, joined: true }));

    const attempt = this.resolve(workspace, force);
    this.running.set(workspace, attempt);
    // Cleared BEFORE the caller is resolved, not in a trailing `finally`. A cleanup that
    // runs after means the next call arrives while the entry is still there and joins a
    // promise that has already settled -- which reports a skip as a join, and reports a
    // failed build as one someone else was already running.
    const clear = () => {
      if (this.running.get(workspace) === attempt) this.running.delete(workspace);
    };
    return attempt.then(
      (value) => {
        clear();
        return { ...value, joined: false };
      },
      (error: unknown) => {
        clear();
        throw error;
      },
    );
  }

  /** The freshness decision and the build, as one shared unit of work. */
  private async resolve(workspace: string, force: boolean): Promise<Omit<BuildResult, "joined">> {
    if (!force) {
      const builtAtMs = this.builtAtMs(workspace);
      const sources = await this.deps.sources(workspace);
      if (!moduleStale(builtAtMs, sources)) {
        const last = this.lastBuild.get(workspace)!;
        return { ...last, skipped: true };
      }
    }
    return { ...(await this.run(workspace)), skipped: false };
  }

  private async run(workspace: string): Promise<BuildAttempt> {
    let attempt: BuildAttempt;
    try {
      const outcome = await this.deps.build(workspace);
      attempt = { ok: outcome.ok, finishedAtMs: this.deps.now(), log: outcome.log };
    } catch (error) {
      // A build that could not even start is a failed build with a reason, not an
      // exception thrown at whoever happened to request the preview.
      attempt = {
        ok: false,
        finishedAtMs: this.deps.now(),
        log: error instanceof Error ? error.message : String(error),
      };
    }
    this.lastBuild.set(workspace, attempt);
    return attempt;
  }

  /** Forgets a workspace, for a run whose directory has been removed. */
  forget(workspace: string): void {
    this.lastBuild.delete(workspace);
    this.running.delete(workspace);
  }
}

/**
 * What to tell an author about a build, in one line.
 *
 * A failed build says so and points at its output. It never reports a preview as ready on
 * the strength of an old build that happens to still be on disk.
 */
export function describeBuild(result: BuildResult): string {
  if (result.skipped) return "The module was already up to date.";
  if (!result.ok)
    return result.joined
      ? "A build already in progress failed; see its output."
      : "The build failed; see its output.";
  return result.joined ? "Built by a request already in progress." : "Built.";
}
