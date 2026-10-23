/**
 * What the views of one open activity share: its routes (activity-api.ts) and one cache of
 * what they read (resource-cache.ts), so a chip and a panel showing the same report read it
 * once, and any view can say the run history changed.
 */
import { createContext, useContext } from "react";
import type { ActivityRun, ActivityRunSummary } from "@waterford/waf-harness-server/api";
import type { ActivityApi, ProjectActivitiesApi } from "./activity-api";
import type { ResourceCache } from "./resource-cache";

export interface ActivityClient {
  api: ActivityApi;
  /** The routes of the project the activity belongs to: its other refs, its setup. */
  project: ProjectActivitiesApi;
  cache: ResourceCache;
}

export const ActivityClientContext = createContext<ActivityClient | null>(null);

/** The open activity's client; only the activity editor's views ask for it. */
export function useActivityClient(): ActivityClient {
  const client = useContext(ActivityClientContext);
  if (!client) throw new Error("useActivityClient outside an activity editor");
  return client;
}

export function summarize({ candidate, ...run }: ActivityRun): ActivityRunSummary {
  return { ...run, hasCandidate: candidate !== null };
}

/** A run just started: it shows at the top of the history at once, and the history is read again. */
export function runStarted(
  { api, cache }: Pick<ActivityClient, "api" | "cache">,
  run: ActivityRun,
): void {
  cache.update(api.runs.list, (runs = []) => [
    summarize(run),
    ...runs.filter((item) => item.runId !== run.runId),
  ]);
  cache.invalidate(api.runs.list);
}
