/**
 * The frame's contract: the URL the gallery builds is the URL the frame reads back, the seeding
 * script writes the app's own storage keys, and a `lang` param reads back as English, the one
 * language there is. A page outside the gallery names two preferences (and `lang=en`) and leaves
 * the rest to the app.
 */
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { THEME_STORAGE_KEYS } from "@waterford/waf-harness-ui/boot";
import {
  APP_FRAME_PATH,
  appFrameSrc,
  embeddedFrameSrc,
  parseFrameParams,
  SEEDED_KEYS,
  storageSeedScript,
} from "../src/app/frame";
import type { FramePrefs } from "../src/app/frame";

const PREFS: FramePrefs = {
  theme: "modern",
  mode: "dark",
  accent: "amber",
  size: "l",
  latin: "mona-sans",
  cjk: "noto-sans-sc",
};

describe("the frame URL", () => {
  it("names the document, the route and every preference, and reads back what it wrote", () => {
    const src = appFrameSrc("/gallery", PREFS, {
      route: "/chat/s-1?tab=x",
      signedOut: true,
      open: "settings",
    });
    expect(src.startsWith(`/gallery${APP_FRAME_PATH}?`)).toBe(true);
    const params = parseFrameParams(src.slice(src.indexOf("?")));
    expect(params).toEqual({
      route: "/chat/s-1?tab=x",
      lang: "en",
      signedOut: true,
      open: "settings",
    });
    for (const [param, key] of Object.entries(SEEDED_KEYS)) {
      expect(src, key).toContain(`${param}=`);
    }
  });

  it("for a page outside the gallery, names the theme, the mode and the language, and reads back as embedded in English", () => {
    const src = embeddedFrameSrc(
      "/gallery",
      { theme: "modern", mode: "dark", lang: "en" },
      "/plugins",
    );
    expect(src.startsWith(`/gallery${APP_FRAME_PATH}?`)).toBe(true);
    expect(parseFrameParams(src.slice(src.indexOf("?")))).toEqual({
      route: "/plugins",
      lang: "en",
      embedded: true,
    });
    // The seeding script writes the theme and the mode and nothing else: every other preference
    // is the app's own default, and the app has no language to seed.
    const window: Record<string, unknown> = {};
    vm.runInContext(
      storageSeedScript(),
      vm.createContext({
        window,
        location: { search: src.slice(src.indexOf("?")) },
        URLSearchParams,
        Object,
      }),
    );
    const storage = window.localStorage as Storage;
    expect(storage.getItem(THEME_STORAGE_KEYS.themeId)).toBe("modern");
    expect(storage.getItem(THEME_STORAGE_KEYS.mode)).toBe("dark");
    expect(storage.length).toBe(2);
  });

  it("opens the chat when the route is missing or not a path, signed in by default", () => {
    expect(parseFrameParams("")).toEqual({ route: "/chat", lang: "en" });
    expect(parseFrameParams("?route=http://evil&lang=fr")).toEqual({ route: "/chat", lang: "en" });
    expect(parseFrameParams("?route=/models&lang=zh")).toEqual({ route: "/models", lang: "en" });
  });

  it("seeds the app's own storage keys, every one of them the package's", () => {
    expect(SEEDED_KEYS).toEqual({
      theme: THEME_STORAGE_KEYS.themeId,
      mode: THEME_STORAGE_KEYS.mode,
      accent: THEME_STORAGE_KEYS.accent,
      size: THEME_STORAGE_KEYS.textSize,
      latin: THEME_STORAGE_KEYS.fontLatin,
      cjk: THEME_STORAGE_KEYS.fontCjk,
    });
  });

  it("is a classic script that gives the document a seeded in-memory storage", () => {
    const src = appFrameSrc("", PREFS, { route: "/models" });
    const search = src.slice(src.indexOf("?"));
    const window: Record<string, unknown> = {};
    const context = vm.createContext({
      window,
      location: { search },
      URLSearchParams,
      Object,
    });
    vm.runInContext(storageSeedScript(), context);
    const storage = window.localStorage as Storage;
    expect(storage.getItem(THEME_STORAGE_KEYS.themeId)).toBe("modern");
    expect(storage.getItem(THEME_STORAGE_KEYS.mode)).toBe("dark");
    expect(storage.getItem(THEME_STORAGE_KEYS.textSize)).toBe("l");
    expect(storage.getItem(THEME_STORAGE_KEYS.fontLatin)).toBe("mona-sans");
    expect(storage.getItem(THEME_STORAGE_KEYS.fontCjk)).toBe("noto-sans-sc");
    expect(storage.getItem("wafh.nothing")).toBeNull();
    // It is a working Storage: writes stay in this document and enumerate.
    storage.setItem("wafh.sidebarCollapsed", "1");
    expect(storage.length).toBe(7);
    expect(storage.key(6)).toBe("wafh.sidebarCollapsed");
    storage.removeItem("wafh.sidebarCollapsed");
    expect(storage.getItem("wafh.sidebarCollapsed")).toBeNull();
    const session = window.sessionStorage as Storage;
    expect(session.length).toBe(0);
    // Dependency-free and strict-safe: no globals leak.
    expect(Object.keys(context).sort()).toEqual([
      "Object",
      "URLSearchParams",
      "location",
      "window",
    ]);
  });
});
