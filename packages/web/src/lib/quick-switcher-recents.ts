/**
 * Recently-selected Quick Switcher entries, one global localStorage list of entry ids
 * (lib/quick-switcher.ts owns what an id names). Recents are a UX nicety, not
 * source-of-truth state, so they live client-side and every failure degrades to "no
 * recents": storage injectable (nav-group-collapse.ts convention — vitest runs in Node,
 * no localStorage), nothing stored / corrupt JSON / non-string items / a throwing store
 * all read back as an empty list, and writing is best-effort (quota limits / private
 * browsing fail silently).
 */

/** Minimal storage interface (the subset of localStorage used here); tests inject an in-memory implementation. */
export interface SwitcherRecentsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The single global storage key (`penguin.…` naming convention); holds a JSON array of entry ids, most recent first. */
export const QUICK_SWITCHER_RECENTS_KEY = "penguin.quickSwitcher.recents";

/** How many recents the palette surfaces; older selections fall off the stored list itself. */
export const QUICK_SWITCHER_RECENTS_LIMIT = 5;

/**
 * Reads the stored ids, newest first. Guarded parse: anything but a JSON array of
 * strings (absent key, a mangled write, a future format) is the empty default, and
 * `localStorage` is resolved INSIDE the try — merely touching it throws a
 * SecurityError when site data is blocked, and this runs from a render-time read.
 */
export function readQuickSwitcherRecents(storage?: SwitcherRecentsStorage): readonly string[] {
  try {
    const raw = (storage ?? localStorage).getItem(QUICK_SWITCHER_RECENTS_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const ids = parsed.filter((x): x is string => typeof x === "string");
    return [...new Set(ids)].slice(0, QUICK_SWITCHER_RECENTS_LIMIT);
  } catch {
    return [];
  }
}

/**
 * Records a selection as the most recent: moves an existing id to the front, drops the
 * oldest past the limit, and persists. Returns the next list (the caller needs no second
 * read); a lost write only costs persistence — the in-memory answer is already correct.
 */
export function pushQuickSwitcherRecent(
  id: string,
  storage?: SwitcherRecentsStorage,
): readonly string[] {
  const next = [id, ...readQuickSwitcherRecents(storage).filter((x) => x !== id)].slice(
    0,
    QUICK_SWITCHER_RECENTS_LIMIT,
  );
  try {
    (storage ?? localStorage).setItem(QUICK_SWITCHER_RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* best-effort persistence (quota limits / private browsing) */
  }
  return next;
}
