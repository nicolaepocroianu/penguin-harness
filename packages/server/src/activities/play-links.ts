/**
 * Play links: the fixed address a played activity is served at (see `play-routes`).
 *
 * As in Loom's dev-sandbox, a link is the activity's address and nothing more: no signature,
 * no expiry, the same link every time and across restarts. Whoever can reach the preview
 * origin can play any activity, which is Loom's model. What keeps a module's code away from
 * the App is where the page is served, not the link: on the App's own host it always runs
 * sandboxed (see `play-routes`).
 *
 * Kept apart from the sandbox so that what makes a link needs nothing. The test browser makes
 * links for the checks it runs, and a module run makes one for its own workspace before its
 * agent starts; neither can depend on the sandbox, which depends on the runs it plays.
 */
import { Component, Interface } from "@waterford/waf-harness-core/kernel";

/**
 * How long a module run counts as played after a link to it was made, so cleanup leaves its
 * folder alone while a check or an author may still be playing it (see `liveRunIds`).
 */
export const PLAY_RUN_LIVE_MS = 12 * 60 * 60 * 1000;

/** What a play link names: one activity's preview, or one of its module runs. */
export interface PlayTarget {
  projectId: string;
  activityId: string;
  /**
   * The module run whose workspace the link plays, while it is still running or once it
   * has succeeded, instead of the activity's playing build. An assembly checks its module
   * in the real player before it finishes. Absent on every link an author opens.
   */
  runId?: string;
}

/** Ids are `[A-Za-z0-9_-]+` (see `isValidId`), so `~` can never be part of one. */
const KEY_SEPARATOR = "~";
const KEY_PART = /^[A-Za-z0-9_-]+$/;

/** The path segment that names a play target: `<project>~<activity>[~<run>]`. */
export function playKey(target: PlayTarget): string {
  return [target.projectId, target.activityId, ...(target.runId ? [target.runId] : [])].join(
    KEY_SEPARATOR,
  );
}

/** The play target a key names, or null when it is not one. */
export function readPlayKey(key: string): PlayTarget | null {
  const parts = key.split(KEY_SEPARATOR);
  if (parts.length < 2 || parts.length > 3 || !parts.every((part) => KEY_PART.test(part)))
    return null;
  const [projectId, activityId, runId] = parts as [string, string, string?];
  return { projectId, activityId, ...(runId ? { runId } : {}) };
}

export abstract class ActivityPlayLinks extends Interface<{
  /** The link segment for a play target; a run's is remembered as played (see `liveRunIds`). */
  link(target: PlayTarget): string;
  /** The module runs a link was made for recently, which cleanup must leave alone. */
  liveRunIds(): string[];
}>() {}

@Component()
export class ActivityPlayLinksService implements ActivityPlayLinks {
  /** When each module run stops counting as played; per process, which is enough for cleanup. */
  private readonly runLinks = new Map<string, number>();

  link(target: PlayTarget): string {
    if (target.runId) this.runLinks.set(target.runId, Date.now() + PLAY_RUN_LIVE_MS);
    return playKey(target);
  }

  liveRunIds(): string[] {
    const now = Date.now();
    for (const [runId, until] of this.runLinks) if (now >= until) this.runLinks.delete(runId);
    return [...this.runLinks.keys()];
  }
}
