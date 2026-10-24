/**
 * The gallery's view state, which lives in the URL so any view can be quoted as a link.
 *
 *   /s/chat?theme=geek&mode=dark&size=l&latin=mona-sans&cjk=theme&accent=neutral&view=phone
 *
 * `theme`, `mode`, `size`, `latin`, `cjk` and `accent` are always written out — they are
 * also the preferences a fresh visit restores from the last one, so a copied link must pin them
 * or it would open on the reader's own — and a link keeps meaning the same thing if a default
 * ever changes. `view` appears only when set: `view=phone` frames every surface at phone width.
 * Pure: parsing never throws, and an unknown or missing value falls back to the caller's
 * fallback (the last-used value) and then to the default. The gallery is English only: a `lang`
 * parameter (the site's links name `lang=en`) is accepted and ignored.
 *
 * The preferences are the app's own: the frame writes them under the app's storage keys, and the
 * gallery's root applies them through the package's `applyThemeAttributes`, so a size or a font
 * pairing chosen here is what a user of the app would have chosen in its Settings.
 */
import { INITIAL_THEME_ID, THEME_IDS } from "@waterford/waf-harness-ui";
import type { ThemeId } from "@waterford/waf-harness-ui";
import { DEFAULT_TEXT_SIZE, TEXT_SIZES } from "@waterford/waf-harness-ui/boot";
import type { TextSize } from "@waterford/waf-harness-ui/boot";
import { ACCENT_IDS, THEME_ACCENT } from "./accents";
import { CJK_FONTS, LATIN_FONTS, LEGACY_SIZES } from "./themes";
import type { FontCjk, FontLatin } from "./themes";

export const MODE_PREFS = ["light", "dark", "system"] as const;
export type ModePref = (typeof MODE_PREFS)[number];

/** Desktop: the app at its window width. Phone: the app in a 390 px frame. */
export const VIEWS = ["desktop", "phone"] as const;
export type View = (typeof VIEWS)[number];

export interface GalleryState {
  theme: ThemeId;
  mode: ModePref;
  size: TextSize;
  latin: FontLatin;
  cjk: FontCjk;
  /**
   * An accent preset id, or `neutral` for the theme's own accent. Kept as chosen even
   * when the active theme does not list it: it resolves to the theme's own accent for now and
   * comes back when the reader returns to a theme that lists it.
   */
  accent: string;
  view: View;
}

export const DEFAULT_STATE: GalleryState = {
  theme: INITIAL_THEME_ID,
  mode: "light",
  size: DEFAULT_TEXT_SIZE,
  latin: "theme",
  cjk: "theme",
  accent: THEME_ACCENT,
  view: "desktop",
};

/** The six preferences a fresh visit restores from the last one when the URL omits them. */
export const PREF_KEYS = ["theme", "mode", "size", "latin", "cjk", "accent"] as const;
export type PrefKey = (typeof PREF_KEYS)[number];
export type RememberedPrefs = Partial<Pick<GalleryState, PrefKey>>;

/**
 * The five the gallery stores under its own keys. The mode is the site's: the public site and
 * the docs keep it under a shared key, and the site navbar sets it here too.
 */
export const GALLERY_PREF_KEYS = ["theme", "size", "latin", "cjk", "accent"] as const;

function pick<T extends string>(
  allowed: readonly T[],
  ...candidates: (string | null | undefined)[]
): T | undefined {
  for (const value of candidates) {
    if (value != null && (allowed as readonly string[]).includes(value)) return value as T;
  }
  return undefined;
}

/** A `size=` value, with the retired `tier=` scale (sm / md / lg) read the way the app migrates it. */
function parseSize(params: URLSearchParams): string | null {
  const size = params.get("size");
  if (size !== null) return LEGACY_SIZES[size] ?? size;
  const tier = params.get("tier");
  return tier === null ? null : (LEGACY_SIZES[tier] ?? null);
}

export function parseGalleryState(search: string, remembered: RememberedPrefs = {}): GalleryState {
  const params = new URLSearchParams(search);
  return {
    theme: pick(THEME_IDS, params.get("theme"), remembered.theme) ?? DEFAULT_STATE.theme,
    mode: pick(MODE_PREFS, params.get("mode"), remembered.mode) ?? DEFAULT_STATE.mode,
    size: pick(TEXT_SIZES, parseSize(params), remembered.size) ?? DEFAULT_STATE.size,
    latin: pick(LATIN_FONTS, params.get("latin"), remembered.latin) ?? DEFAULT_STATE.latin,
    cjk: pick(CJK_FONTS, params.get("cjk"), remembered.cjk) ?? DEFAULT_STATE.cjk,
    accent: pick(ACCENT_IDS, params.get("accent"), remembered.accent) ?? DEFAULT_STATE.accent,
    view: pick(VIEWS, params.get("view")) ?? DEFAULT_STATE.view,
  };
}

/** What storage holds: the gallery's own keys (`wafh-gallery.<key>`) and the site's mode. */
export interface StoredPrefs {
  gallery: Partial<Record<PrefKey, string>>;
  siteTheme: ModePref | null;
}

/**
 * The preferences a visit restores when its URL omits them. The mode follows the site,
 * defaulting as there to the system's. The gallery stored its own `mode` before the three sites
 * shared it; that is read only while the site has no value of its own, so a returning reader
 * keeps the choice they made here. Whoever prepares the 0.3.0 release removes that fallback and
 * its test scenario; a reader with only the old key then opens once in the system's mode.
 */
export function rememberedPrefs(stored: StoredPrefs): RememberedPrefs {
  const { gallery, siteTheme } = stored;
  const own: Record<string, string> = {};
  for (const key of GALLERY_PREF_KEYS) {
    const value = gallery[key];
    if (value) own[key] = value;
  }
  return {
    ...(own as RememberedPrefs),
    mode: siteTheme ?? pick(MODE_PREFS, gallery.mode) ?? "system",
  };
}

/** A readable query component: `encodeURIComponent` keeps `-_.!~*'()` as they are. */
const enc = encodeURIComponent;

/**
 * The canonical query string (with its leading `?`) for a state. `extra` params come right after
 * the preferences, in the order given.
 */
export function formatGalleryQuery(
  state: GalleryState,
  extra: Readonly<Record<string, string>> = {},
): string {
  const parts = PREF_KEYS.map((key) => `${key}=${enc(state[key])}`);
  for (const [key, value] of Object.entries(extra)) parts.push(`${enc(key)}=${enc(value)}`);
  if (state.view !== DEFAULT_STATE.view) parts.push(`view=${enc(state.view)}`);
  return `?${parts.join("&")}`;
}

/** `system` resolved against the OS preference; every other mode is itself. */
export function resolveMode(mode: ModePref, prefersDark: boolean): "light" | "dark" {
  return mode === "system" ? (prefersDark ? "dark" : "light") : mode;
}
