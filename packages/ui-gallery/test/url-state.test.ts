/**
 * The gallery's view state: what a URL pins, and what a visit restores where the URL is silent.
 *
 * - Given any view, its canonical query parses back to the same view, the six preferences always
 *   written out and the phone view only when set; unknown values fall back to the remembered
 *   value, then to the default.
 * - Given a `lang` param (the landing page's links name `lang=en`), it is accepted and ignored:
 *   the gallery is English only.
 * - Given the site's light/dark is stored (by any of the three sites), a visit restores it, over
 *   what the gallery stored itself before the sites shared it.
 * - Given only the gallery's own older `mode` is stored, a returning visit keeps it.
 * - Given nothing stored, a visit follows the system mode, as the landing page and the docs do.
 * - The gallery's other preferences (theme, size, fonts, accent) stay its own.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_STATE,
  formatGalleryQuery,
  parseGalleryState,
  PREF_KEYS,
  rememberedPrefs,
  resolveMode,
} from "../src/lib/url-state";

const PREFS = "theme=modern&mode=light&size=m&latin=theme&cjk=theme&accent=neutral";

describe("gallery URL state", () => {
  it("reads every field and round-trips through the canonical query", () => {
    const search =
      "?theme=geek&mode=dark&size=xl&latin=mona-sans&cjk=noto-sans-sc&accent=blue&view=phone";
    const state = parseGalleryState(search);
    expect(state).toEqual({
      theme: "geek",
      mode: "dark",
      size: "xl",
      latin: "mona-sans",
      cjk: "noto-sans-sc",
      accent: "blue",
      view: "phone",
    });
    expect(parseGalleryState(formatGalleryQuery(state))).toEqual(state);
  });

  it("opens on the 16px size, the theme's own faces and the theme's own accent", () => {
    expect(DEFAULT_STATE.size).toBe("m");
    expect(DEFAULT_STATE.latin).toBe("theme");
    expect(DEFAULT_STATE.cjk).toBe("theme");
    expect(PREF_KEYS).toEqual(["theme", "mode", "size", "latin", "cjk", "accent"]);
  });

  it("always writes the six preferences and the view only when set", () => {
    expect(formatGalleryQuery(DEFAULT_STATE)).toBe(`?${PREFS}`);
    expect(formatGalleryQuery({ ...DEFAULT_STATE, view: "phone" })).toBe(`?${PREFS}&view=phone`);
  });

  it("ignores the retired compare param: a link quoted with it opens on one frame", () => {
    expect(parseGalleryState("?compare=1")).toEqual(DEFAULT_STATE);
    expect(parseGalleryState("?compare=chat")).toEqual(DEFAULT_STATE);
    expect(formatGalleryQuery(parseGalleryState("?compare=1"))).not.toContain("compare");
  });

  it("keeps route params right after the preferences, in the order given", () => {
    expect(formatGalleryQuery({ ...DEFAULT_STATE, theme: "modern" }, { a: "1", b: "2" })).toBe(
      "?theme=modern&mode=light&size=m&latin=theme&cjk=theme&accent=neutral&a=1&b=2",
    );
  });

  it("still opens a link quoted with the retired three-step size, by its pixels", () => {
    expect(parseGalleryState("?size=sm").size).toBe("m");
    expect(parseGalleryState("?size=md").size).toBe("l");
    expect(parseGalleryState("?size=lg").size).toBe("xl");
    expect(parseGalleryState("?tier=lg").size).toBe("xl");
    expect(parseGalleryState("?tier=md&size=xs").size).toBe("xs");
    expect(formatGalleryQuery(parseGalleryState("?size=md"))).toContain("size=l");
  });

  it("falls back to the remembered value, then the default, for anything unknown", () => {
    expect(
      parseGalleryState(
        "?theme=nope&mode=sepia&size=xxl&latin=comic&cjk=nope&lang=fr&accent=plaid&view=tv",
      ),
    ).toEqual(DEFAULT_STATE);
    expect(
      parseGalleryState("?theme=nope", { theme: "github", latin: "misans", size: "l" }),
    ).toMatchObject({ theme: "github", latin: "misans", size: "l" });
    // The URL beats the remembered value.
    expect(parseGalleryState("?theme=geek", { theme: "github" }).theme).toBe("geek");
  });

  it("accepts a lang param, which changes nothing: the gallery is English only", () => {
    expect(parseGalleryState("?lang=en")).toEqual(DEFAULT_STATE);
    expect(parseGalleryState("?lang=zh&mode=dark")).toEqual({ ...DEFAULT_STATE, mode: "dark" });
    expect(formatGalleryQuery(parseGalleryState("?lang=en&mode=light"))).not.toContain("lang");
  });

  it("keeps an accent preset whichever theme is active, so switching themes never loses it", () => {
    expect(parseGalleryState("?theme=geek&accent=blue")).toMatchObject({
      theme: "geek",
      accent: "blue",
    });
  });

  it("resolves system mode against the OS preference", () => {
    expect(resolveMode("system", true)).toBe("dark");
    expect(resolveMode("system", false)).toBe("light");
    expect(resolveMode("light", true)).toBe("light");
  });
});

describe("what a visit restores where the URL is silent", () => {
  const nothing = { gallery: {}, siteTheme: null };

  it("opens in the site's light/dark, over the gallery's older own", () => {
    const stored = { gallery: { mode: "light" }, siteTheme: "dark" as const };
    expect(rememberedPrefs(stored)).toMatchObject({ mode: "dark" });
    // The URL still beats it: a quoted link opens as quoted.
    const state = parseGalleryState("?mode=light&lang=en", rememberedPrefs(stored));
    expect(state).toMatchObject({ mode: "light" });
  });

  it("keeps a returning reader's own choice while the site has none", () => {
    const stored = { ...nothing, gallery: { mode: "dark" } };
    expect(rememberedPrefs(stored)).toMatchObject({ mode: "dark" });
  });

  it("follows the system when nothing is stored, as the other two sites do", () => {
    expect(rememberedPrefs(nothing)).toEqual({ mode: "system" });
  });

  it("ignores an unreadable older value and keeps the gallery's other preferences its own", () => {
    const stored = {
      ...nothing,
      gallery: { mode: "dusk", theme: "geek", size: "l", accent: "blue" },
    };
    expect(rememberedPrefs(stored)).toEqual({
      theme: "geek",
      size: "l",
      accent: "blue",
      mode: "system",
    });
  });
});
