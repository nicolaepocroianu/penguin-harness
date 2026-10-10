/**
 * When the activity list may be stale, handed on from the user channel (state/sessions.tsx
 * applyUserEvent) to whichever page lists activities: a Project's activity run finished
 * (`activity_run_finished`), or the stream lost events it cannot replay (`resync_required`),
 * so a finish may have been missed in any Project. The list re-reads its cards on either
 * instead of polling while a run is in flight.
 */
import type { ActivityServerEvent } from "@prismshadow/penguin-server/api";

/** The Project whose list is stale, or null when it may be any Project's. */
type Listener = (projectId: string | null) => void;

const listeners = new Set<Listener>();

function notify(projectId: string | null): void {
  for (const listener of [...listeners]) listener(projectId);
}

export function publishActivityRunFinished(event: ActivityServerEvent): void {
  notify(event.projectId);
}

/** The user channel dropped events: every list re-reads, since any run may have finished. */
export function publishActivityRunsResync(): void {
  notify(null);
}

/** Calls `listener` whenever a list may be stale from now on; returns the unsubscribe. */
export function subscribeActivityListStale(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
