/**
 * A small keyed cache of server reads, so views that show the same resource read it once and
 * stay in step: concurrent reads of one version share a request, a read superseded by a newer
 * one is dropped instead of landing late, and any view can say a resource changed.
 *
 * Plain TS so it runs in node; `use-resource.ts` is its React hook.
 */

/** One server resource: what identifies it in the cache, and how it is read. */
export interface Resource<T> {
  readonly key: string;
  load(): Promise<T>;
}

/** What the cache holds for a resource: the last value read, and the last read's failure. */
export interface ResourceSnapshot<T> {
  /** The last value read or put; undefined until the first one arrives. */
  data: T | undefined;
  /** Why the latest read failed; null once a later read succeeds. */
  error: unknown;
  /** The version of the read that settled last; "" for a value put. */
  version: string;
}

interface Entry {
  snapshot: ResourceSnapshot<unknown>;
  /** The read in flight, if any, and which version it reads. */
  inflight: { version: string; promise: Promise<unknown> } | null;
  /** Bumped by every read started and every put, so only the newest lands. */
  seq: number;
  listeners: Set<() => void>;
  watchers: Set<() => void>;
}

const EMPTY: ResourceSnapshot<never> = { data: undefined, error: null, version: "" };

export class ResourceCache {
  private readonly entries = new Map<string, Entry>();
  /** Numbers the fresh reads, so none shares a version with another. */
  private fresh = 0;

  private entry(key: string): Entry {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        snapshot: EMPTY,
        inflight: null,
        seq: 0,
        listeners: new Set(),
        watchers: new Set(),
      };
      this.entries.set(key, entry);
    }
    return entry;
  }

  private settle(entry: Entry, snapshot: ResourceSnapshot<unknown>): void {
    entry.snapshot = snapshot;
    for (const listener of entry.listeners) listener();
  }

  /** What the cache holds for `resource` now. Stable until it changes. */
  peek<T>(resource: Resource<T>): ResourceSnapshot<T> {
    return (this.entries.get(resource.key)?.snapshot ?? EMPTY) as ResourceSnapshot<T>;
  }

  /** Called whenever what the cache holds for `resource` changes. */
  subscribe(resource: Resource<unknown>, listener: () => void): () => void {
    const entry = this.entry(resource.key);
    entry.listeners.add(listener);
    return () => entry.listeners.delete(listener);
  }

  /**
   * Read `resource`. A read of the same version already in flight is shared; any other starts
   * a new request, and an older one still in flight is then dropped when it answers.
   */
  read<T>(resource: Resource<T>, version = ""): Promise<T> {
    const entry = this.entry(resource.key);
    if (entry.inflight && entry.inflight.version === version)
      return entry.inflight.promise as Promise<T>;
    const seq = ++entry.seq;
    const promise = resource.load().then(
      (data) => {
        if (entry.seq === seq) {
          entry.inflight = null;
          this.settle(entry, { data, error: null, version });
        }
        return data;
      },
      (error: unknown) => {
        if (entry.seq === seq) {
          entry.inflight = null;
          this.settle(entry, { data: entry.snapshot.data, error, version });
        }
        throw error;
      },
    );
    entry.inflight = { version, promise };
    return promise;
  }

  /** Read `resource` afresh, never sharing a read already in flight: one that must follow a change. */
  refresh<T>(resource: Resource<T>): Promise<T> {
    return this.read(resource, `#fresh-${++this.fresh}`);
  }

  /** Hold `data` as the resource's value, as if just read; a read in flight is dropped. */
  put<T>(resource: Resource<T>, data: T): void {
    const entry = this.entry(resource.key);
    entry.seq++;
    entry.inflight = null;
    this.settle(entry, { data, error: null, version: "" });
  }

  /** Change the value held, e.g. to show a run that just started before the next read. */
  update<T>(resource: Resource<T>, change: (current: T | undefined) => T): void {
    const entry = this.entry(resource.key);
    this.settle(entry, { ...entry.snapshot, data: change(entry.snapshot.data as T | undefined) });
  }

  /** Say the resource changed on the server: whoever watches it reads it again. */
  invalidate(resource: Resource<unknown>): void {
    for (const watcher of this.entry(resource.key).watchers) watcher();
  }

  /** Called when `resource` is invalidated. */
  watch(resource: Resource<unknown>, watcher: () => void): () => void {
    const entry = this.entry(resource.key);
    entry.watchers.add(watcher);
    return () => entry.watchers.delete(watcher);
  }
}
