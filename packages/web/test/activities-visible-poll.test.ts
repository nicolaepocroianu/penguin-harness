import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollWhileVisible } from "../src/features/activities/visible-poll";

/** A page whose visibility the test sets, telling the poll as a browser would. */
function page() {
  const listeners = new Set<() => void>();
  const view = {
    visibilityState: "visible" as DocumentVisibilityState,
    addEventListener: (_type: "visibilitychange", listener: () => void) =>
      void listeners.add(listener),
    removeEventListener: (_type: "visibilitychange", listener: () => void) =>
      void listeners.delete(listener),
    show(visible: boolean) {
      view.visibilityState = visible ? "visible" : "hidden";
      for (const listener of listeners) listener();
    },
  };
  return view;
}

/** A read the test answers by hand, each answer asking for the next read in `delay` ms. */
function reads(delay = 1000) {
  const pending: (() => void)[] = [];
  const read = vi.fn(
    () =>
      new Promise<number>((resolve) => {
        pending.push(() => resolve(delay));
      }),
  );
  const answer = async () => {
    pending.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
  };
  return { read, answer };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("a poll while the page is on screen", () => {
  it("reads at the pace each read asks for, stops while hidden, and reads once on coming back", async () => {
    const view = page();
    const { read, answer } = reads();
    const stop = pollWhileVisible(read, view);
    expect(read).toHaveBeenCalledTimes(1);
    await answer();
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(2);
    await answer();

    view.show(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(2);

    view.show(true);
    expect(read).toHaveBeenCalledTimes(3);
    await answer();
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(4);
    stop();
  });

  it("sets no next read off when the page hid while a read was out", async () => {
    const view = page();
    const { read, answer } = reads();
    pollWhileVisible(read, view);
    view.show(false);
    await answer();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("does not read twice when the page shows again while a read is out", async () => {
    const view = page();
    const { read, answer } = reads();
    pollWhileVisible(read, view);
    view.show(false);
    view.show(true);
    expect(read).toHaveBeenCalledTimes(1);
    // The read that was out sets the next one off.
    await answer();
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("loads once while hidden, then waits to be shown", async () => {
    const view = page();
    view.visibilityState = "hidden";
    const { read, answer } = reads();
    pollWhileVisible(read, view);
    expect(read).toHaveBeenCalledTimes(1);
    await answer();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reads nothing more once stopped, shown or not", async () => {
    const view = page();
    const { read, answer } = reads();
    const stop = pollWhileVisible(read, view);
    await answer();
    stop();
    view.show(false);
    view.show(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
