import { AsyncLocalStorage } from "node:async_hooks";
import { Component, Interface } from "@waterford/waf-harness-core/kernel";

/** Serializes compare-and-publish operations within the server's single-writer lifetime. */
export class ActivityLocks {
  private readonly pending = new Map<string, Promise<unknown>>();
  async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    this.pending.set(key, next);
    try {
      return await next;
    } finally {
      if (this.pending.get(key) === next) this.pending.delete(key);
    }
  }
}

/**
 * The one lock each activity has, shared by everything that changes the activity: its draft,
 * its files and its runs. Whoever checks that no run is working on an activity and whoever
 * opens a run both hold it, so the two cannot interleave.
 */
export abstract class ActivityLock extends Interface<{
  /**
   * Runs `operation` once nothing else holds the activity, and holds it until `operation`
   * settles. Always waits, so work started inside a hold and left running after it (a
   * background generation) waits for the hold to end rather than slipping into it.
   */
  run<T>(activityId: string, operation: () => Promise<T>): Promise<T>;
  /**
   * As `run`, except that called from inside an operation that still holds the activity, it
   * joins that hold instead of waiting behind it for ever.
   */
  join<T>(activityId: string, operation: () => Promise<T>): Promise<T>;
}>() {}

interface Hold {
  ended: boolean;
}

@Component()
export class ActivityLockService implements ActivityLock {
  private readonly locks = new ActivityLocks();
  /** The holds the running work is inside, by activity. */
  private readonly holds = new AsyncLocalStorage<ReadonlyMap<string, Hold>>();

  run<T>(activityId: string, operation: () => Promise<T>): Promise<T> {
    return this.locks.run(activityId, async () => {
      const hold: Hold = { ended: false };
      const holds = new Map(this.holds.getStore() ?? []);
      holds.set(activityId, hold);
      try {
        return await this.holds.run(holds, operation);
      } finally {
        hold.ended = true;
      }
    });
  }

  join<T>(activityId: string, operation: () => Promise<T>): Promise<T> {
    const hold = this.holds.getStore()?.get(activityId);
    return hold && !hold.ended ? operation() : this.run(activityId, operation);
  }
}
