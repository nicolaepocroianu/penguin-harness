/**
 * A read repeated on a timer for as long as the page is on screen. A hidden tab asks nothing:
 * the timer stops when the page hides, the read runs once as soon as it shows again, and the
 * timer then carries on at the pace each read asks for.
 *
 * Plain TS so it runs in node; the page passes `document`.
 */

/** The part of `document` the poll watches. */
export interface PageVisibility {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

/**
 * Run `read` now, then again each time the delay it resolves with (in ms) has passed. `read`
 * never rejects: it reports its own failures and says when to try again. The first read runs
 * hidden or not, since it is what the page loads. Returns the stop.
 */
export function pollWhileVisible(read: () => Promise<number>, page: PageVisibility): () => void {
  let stopped = false;
  let reading = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clearTimer = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const run = async () => {
    timer = undefined;
    reading = true;
    const delay = await read();
    reading = false;
    if (!stopped && page.visibilityState === "visible") timer = setTimeout(() => void run(), delay);
  };
  const changed = () => {
    if (stopped) return;
    clearTimer();
    // A read on its way already sets the next one off when it answers.
    if (page.visibilityState === "visible" && !reading) void run();
  };
  page.addEventListener("visibilitychange", changed);
  void run();
  return () => {
    stopped = true;
    clearTimer();
    page.removeEventListener("visibilitychange", changed);
  };
}
