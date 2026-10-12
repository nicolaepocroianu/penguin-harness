/** React's view of `ResourceCache` (resource-cache.ts). */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { Resource, ResourceCache, ResourceSnapshot } from "./resource-cache";

/**
 * What the cache holds for `resource`, re-rendering as it changes. With a `version`, the
 * resource is read on mount and again whenever the version changes; views that pass the same
 * version at the same moment share one request. Null reads nothing.
 */
export function useResource<T>(
  cache: ResourceCache,
  resource: Resource<T>,
  version: string | null = null,
): ResourceSnapshot<T> {
  const subscribe = useCallback(
    (listener: () => void) => cache.subscribe(resource, listener),
    // The key names the resource; a new object for the same key is the same resource.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cache, resource.key],
  );
  const snapshot = useSyncExternalStore(subscribe, () => cache.peek(resource));
  useEffect(() => {
    if (version === null) return;
    // A failed read is in the snapshot; nothing else waits on this promise.
    cache.read(resource, version).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache, resource.key, version]);
  return snapshot;
}
