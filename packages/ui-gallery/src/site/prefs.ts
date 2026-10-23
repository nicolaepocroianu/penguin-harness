/**
 * The site navbar's theme, bound to the gallery's view: the same hook the landing page's toggle
 * reads (`useTheme`), so the toggle here is its markup unchanged. The public site is English
 * only, so there is no language to bind.
 *
 * The gallery's `mode` is the site's light/dark: the toggle writes the site's shared key, which
 * the landing page and the docs read, and rewrites the view's URL, so the page and its frames
 * switch with it.
 */
import { useCallback, useEffect } from "react";
import { SITE_THEME_KEY, subscribeSitePref, writeSitePref } from "@waterford/waf-harness-ui/site";
import { MODE_PREFS } from "../lib/url-state";
import type { ModePref } from "../lib/url-state";
import { useGallery } from "../state";

export type ThemeMode = ModePref;

export function useTheme(): { mode: ThemeMode; setMode: (mode: ThemeMode) => void } {
  const { state, update } = useGallery();
  const setMode = useCallback(
    (mode: ThemeMode) => {
      writeSitePref(SITE_THEME_KEY, mode);
      update({ mode });
    },
    [update],
  );
  return { mode: state.mode, setMode };
}

/** Follows a sibling site writing the shared key in another tab, as their own pages do. */
export function useSitePrefsSync(): void {
  const { update } = useGallery();
  useEffect(
    () => subscribeSitePref<ThemeMode>(SITE_THEME_KEY, MODE_PREFS, (mode) => update({ mode })),
    [update],
  );
}
