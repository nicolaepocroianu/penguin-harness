/**
 * The server's "an activity run finished" events, handed on from the user channel
 * (state/sessions.tsx applyUserEvent) to whichever page lists activities. The activity list
 * refreshes its cards on one instead of polling while a run is in flight.
 */
import type { ActivityServerEvent } from "@prismshadow/penguin-server/api";

type Listener = (event: ActivityServerEvent) => void;

const listeners = new Set<Listener>();

export function publishActivityRunFinished(event: ActivityServerEvent): void {
  for (const listener of [...listeners]) listener(event);
}

/** Calls `listener` for every run that finishes from now on; returns the unsubscribe. */
export function subscribeActivityRunFinished(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
