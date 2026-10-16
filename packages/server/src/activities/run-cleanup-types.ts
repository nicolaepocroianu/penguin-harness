/**
 * Cleaning up activity runs, as the admin routes answer it (see run-cleanup.ts). Type-only, so
 * the web reads it without the server.
 */

/**
 * What a cleanup removes, in the order it is shown:
 *
 *   stagedCopies   the media copies an assembly was staged with, and packages its agent
 *                  installed itself (not the linked shared ones), in finished module runs
 *   olderRuns      the folders of finished runs beyond the newest of their activity and kind
 *   orphanTakes    takes nobody accepted, of runs this server does not have (their project or
 *                  activity was deleted), in the WAF checkout's media; only when asked for. A take
 *                  whose run this server never had (one a git pull or Loom brought) counts too
 */
export type RunCleanupCategory = "stagedCopies" | "olderRuns" | "orphanTakes";

/** How long a dry run can be confirmed after it was made. */
export const RUN_CLEANUP_PLAN_TTL_MS = 10 * 60 * 1000;

/** How many runs of each activity and kind are kept when nothing is chosen. */
export const RUN_CLEANUP_KEEP_DEFAULT = 5;
/** The fewest and the most runs of each activity and kind a cleanup may be asked to keep. */
export const RUN_CLEANUP_KEEP_MIN = 1;
export const RUN_CLEANUP_KEEP_MAX = 100;

export interface RunCleanupOptions {
  /** How many of each activity's runs of one kind keep their folders, newest first. */
  keepNewest: number;
  /** Whether takes of runs the server no longer has are removed too; off unless asked. */
  orphanTakes: boolean;
}

export interface RunCleanupTally {
  category: RunCleanupCategory;
  /** Folders (stagedCopies, olderRuns) or files (orphanTakes). */
  items: number;
  bytes: number;
}

/** What a cleanup would remove (a dry run), or what it removed. */
export interface RunCleanupReport {
  keepNewest: number;
  orphanTakes: boolean;
  /** One tally per category, in order; orphanTakes only when it was asked for. */
  categories: RunCleanupTally[];
  /** Activities whose runs were all kept, because their draft could not be read. */
  unreadActivities: number;
  /**
   * The WAF checkout's media was not looked at: the managed workspace is not ready, or the
   * server uses an existing checkout, which is its owner's. Only when orphanTakes was asked for.
   */
  takesUnavailable?: true;
  /** Folders and files that could not be removed and were left in place; 0 on a dry run. */
  failed: number;
  /**
   * Folders and files the confirmed dry run listed that were kept, because something came to
   * need them since (a run started, a build was pinned or played); 0 on a dry run.
   */
  keptSincePlan: number;
}

/**
 * A dry run, which a cleanup confirms by its id: the cleanup removes only what it listed that is
 * still eligible then, never more. It can be confirmed once, until `expiresAt`.
 */
export interface RunCleanupPlan extends RunCleanupReport {
  planId: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
}

/** The disk activity runs take: every run folder together. */
export interface RunStorage {
  bytes: number;
  /** How many run folders there are. */
  folders: number;
}

export interface RunCleanupPlanResponse {
  plan: RunCleanupPlan;
}

export interface RunCleanupReportResponse {
  report: RunCleanupReport;
}

export interface RunStorageResponse {
  storage: RunStorage;
}
