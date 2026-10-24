/**
 * Preferences shared by the docs site and the gallery.
 *
 * The two are separate SPAs that may share an origin, so a single localStorage key is all it takes
 * for a language or theme choice to survive the hop between them. They once wrote
 * `wafh-landing.*` and `wafh-docs.*`; those keys are still read as a fallback, so a visitor
 * who chose before the sites shared a key keeps that choice.
 *
 * Each site's index.html spells the theme key and its fallbacks in the inline script that applies
 * dark mode before first paint; keep those scripts in step with the keys here.
 */

export const SITE_THEME_KEY = "wafh-site.theme";
export const SITE_LANG_KEY = "wafh-site.lang";

/** Pre-unification keys, still read so an existing visitor keeps their choice. */
const LEGACY_KEYS: Record<string, readonly string[]> = {
  [SITE_THEME_KEY]: ["wafh-landing.theme", "wafh-docs.theme"],
  [SITE_LANG_KEY]: ["wafh-landing.lang", "wafh-docs.lang"],
};

/**
 * Reads a stored preference, falling back to the retired per-site keys. Everything is
 * wrapped: localStorage throws outright in a cookie-blocked or partitioned context, and
 * a preference is never worth taking the page down for.
 */
export function readSitePref<T extends string>(key: string, allowed: readonly T[]): T | null {
  try {
    for (const k of [key, ...(LEGACY_KEYS[key] ?? [])]) {
      const stored = localStorage.getItem(k);
      if (stored && (allowed as readonly string[]).includes(stored)) return stored as T;
    }
  } catch {
    // Storage unavailable — fall through to the system default.
  }
  return null;
}

export function writeSitePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Non-persistent session: the choice still applies for this page.
  }
}

/**
 * Live sync for the both-tabs-open case. The storage event fires in every *other* tab on
 * the origin, so switching theme on the gallery updates an already-open docs tab
 * without a reload. Navigating between the sites is a full page load and is covered
 * by the read on mount instead.
 */
export function subscribeSitePref<T extends string>(
  key: string,
  allowed: readonly T[],
  onChange: (value: T) => void,
): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key !== key || e.newValue === null) return;
    if ((allowed as readonly string[]).includes(e.newValue)) onChange(e.newValue as T);
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
