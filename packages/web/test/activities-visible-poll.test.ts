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

  it("goes on reading while hidden at the asked pace for as long as the page asks, then stops", async () => {
    const view = page();
    const { read, answer } = reads();
    let queued = true;
    pollWhileVisible(read, view, () => queued);
    await answer();
    // The read already set off stands when the page hides.
    view.show(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(2);
    await answer();
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(3);
    // The page is asked again after each read: once it is done, the read out is the last.
    queued = false;
    await answer();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(3);
    view.show(true);
    expect(read).toHaveBeenCalledTimes(4);
  });

  it("reads on from a load in a hidden tab while the page asks it to", async () => {
    const view = page();
    view.visibilityState = "hidden";
    const { read, answer } = reads();
    pollWhileVisible(read, view, () => true);
    await answer();
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("goes on after a read that rejects, though reads should not, and logs it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = page();
    const broken = new Error("broken read");
    const read = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(broken)
      .mockRejectedValueOnce(broken)
      .mockResolvedValue(1000);
    const stop = pollWhileVisible(read, view);
    await vi.advanceTimersByTimeAsync(0);
    expect(logged).toHaveBeenCalledWith(broken);
    // The read asked for no delay, so the next waits the poll's own.
    await vi.advanceTimersByTimeAsync(29_999);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(0);
    // Hidden, then shown again, it reads at once: the rejected read is not still out.
    view.show(false);
    view.show(true);
    expect(read).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(4);
    expect(logged).toHaveBeenCalledTimes(2);
    stop();
    logged.mockRestore();
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
