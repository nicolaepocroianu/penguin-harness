/**
 * The sidebar's nav entries and how they fold (lib/nav-group-collapse.ts): the Library holds the
 * fixed slot; every other entry — Media, New chat and the harness pages — is pinned (always
 * shown) or collapsible (inside the Harness group, folded away by its heading row), and the fold
 * and the pin choices each persist in one global localStorage key.
 *
 * - The activity pages come first, then New chat, then the harness pages; a member sees the
 *   admin's pages minus the admin-only Machines page, and nothing else. New chat's nav label is
 *   its tooltip's, and the Machines page heading is its nav label.
 * - By default the Library and Media are pinned and the rest sit in the Harness group; a
 *   member's areas are cut from their own entries.
 * - A pin toggle stores only the deviation from the default, both areas keep entry order
 *   whatever order the moves came in, moving back removes the stored choice, and a move that
 *   changes nothing returns the same record. The Library is always pinned; New chat can move.
 * - Everything pinned leaves nothing to fold; everything collapsible folds to the Library alone.
 * - Expanded shows the pinned area then the collapsible one; collapsed shows the pinned area.
 * - With nothing stored the fold is expanded and no pin is moved, and reading writes nothing;
 *   each choice persists and a remount reads it back.
 * - An unrecognized fold value reads as expanded; pin choices keep only known entries with
 *   boolean values, and anything unparseable reads as none.
 * - A storage that throws (quota, private mode, a throwing getter) never escapes: storing is a
 *   no-op and reading yields the defaults.
 */
import { describe, expect, it } from "vitest";
import {
  NAV_GROUP_COLLAPSED_KEY,
  NAV_PINNED_KEY,
  initialNavGroupCollapsed,
  initialNavPinOverrides,
  isNavPinnable,
  isNavPinned,
  navEntryKeysFor,
  navKeysFor,
  splitNavEntries,
  storeNavGroupCollapsed,
  storeNavPinOverrides,
  visibleNavKeys,
  withNavPinned,
} from "../src/lib/nav-group-collapse";
import type { NavCollapseStorage, NavPinOverrides } from "../src/lib/nav-group-collapse";
import { en } from "../src/lib/strings-en";
import { blockedStorage, memoryStorage } from "./helpers/storage";

/** Storage whose GETTER throws (blocked site data): touching the method itself raises. */
const hostileStorage = {
  get getItem(): never {
    throw new Error("SecurityError");
  },
  setItem: () => undefined,
} as unknown as NavCollapseStorage;

const PINNED = ["activities", "media"];
const HARNESS = ["newChat", "agents", "models", "plugins", "machines", "usage", "benchmark"];

describe("navEntryKeysFor", () => {
  it("puts the activity pages first, then New chat, then the harness pages", () => {
    expect([...navEntryKeysFor(true)]).toEqual([...PINNED, ...HARNESS]);
    expect([...navEntryKeysFor(false)]).toEqual([
      ...PINNED,
      ...HARNESS.filter((key) => key !== "machines"),
    ]);
    expect(navEntryKeysFor(true).filter((key) => key !== "newChat")).toEqual(navKeysFor(true));
  });

  it("New chat's nav label is the one its tooltip and the collapsed rail use", () => {
    expect(en.nav.newChat).toBe(en.chat.newSessionMenu);
  });

  it("the Machines page heading is its nav label", () => {
    expect(en.machines.pageTitle).toBe(en.nav.machines);
  });
});

describe("navKeysFor", () => {
  it("a member sees the admin's entries minus Machines, which the server refuses them", () => {
    // /api/machines is admin-gated server-side (it spawns ssh with the server account's
    // keys), so offering a member the row would only ever produce a 403.
    expect(navKeysFor(true)).toContain("machines");
    expect(navKeysFor(false)).toEqual(navKeysFor(true).filter((key) => key !== "machines"));
  });
});

describe("pinned vs. collapsible", () => {
  it("defaults: the Library and Media pinned; New chat and the harness pages in the Harness group", () => {
    expect(splitNavEntries(navEntryKeysFor(true), {})).toEqual({
      pinned: PINNED,
      collapsible: HARNESS,
    });
  });

  it("a member's areas are cut from their own entries: an admin-only page is in neither", () => {
    expect(splitNavEntries(navEntryKeysFor(false), {})).toEqual({
      pinned: PINNED,
      collapsible: HARNESS.filter((key) => key !== "machines"),
    });
    // A choice stored for it (an admin signed in on this browser before) offers nothing.
    const { pinned, collapsible } = splitNavEntries(navEntryKeysFor(false), { machines: true });
    expect([...pinned, ...collapsible]).not.toContain("machines");
  });

  it("pinning stores the deviation, and the entry joins the pinned area in entry order", () => {
    const pinnedModels = withNavPinned({}, "models", true);
    expect(pinnedModels).toEqual({ models: true });
    expect(isNavPinned("models", pinnedModels)).toBe(true);
    expect(splitNavEntries(navEntryKeysFor(true), pinnedModels)).toEqual({
      pinned: [...PINNED, "models"],
      collapsible: HARNESS.filter((key) => key !== "models"),
    });
  });

  it("pinning keeps entry order however the moves were ordered", () => {
    const first = withNavPinned(withNavPinned({}, "benchmark", true), "newChat", true);
    const second = withNavPinned(withNavPinned({}, "newChat", true), "benchmark", true);
    expect(first).toEqual(second);
    expect(splitNavEntries(navEntryKeysFor(true), first)).toEqual({
      pinned: [...PINNED, "newChat", "benchmark"],
      collapsible: ["agents", "models", "plugins", "machines", "usage"],
    });
  });

  it("moving an entry back to its default removes the stored choice", () => {
    const back = withNavPinned(withNavPinned({}, "models", true), "models", false);
    expect(back).toEqual({});
    expect("models" in back).toBe(false);
    const media = withNavPinned(withNavPinned({}, "media", false), "media", true);
    expect(media).toEqual({});
  });

  it("a move that changes nothing returns the same object, so the caller skips the write", () => {
    const overrides: NavPinOverrides = { models: true };
    expect(withNavPinned(overrides, "agents", false)).toBe(overrides);
    expect(withNavPinned(overrides, "models", true)).toBe(overrides);
    expect(withNavPinned(overrides, "media", true)).toBe(overrides);
  });

  it("the Library is always pinned: no choice moves it, and a stored one is ignored", () => {
    expect(isNavPinnable("activities")).toBe(false);
    expect(isNavPinnable("newChat")).toBe(true);
    const overrides: NavPinOverrides = {};
    expect(withNavPinned(overrides, "activities", false)).toBe(overrides);
    expect(isNavPinned("activities", { activities: false })).toBe(true);
    expect(splitNavEntries(navEntryKeysFor(true), { activities: false }).pinned[0]).toBe(
      "activities",
    );
    const storage = memoryStorage();
    storage.setItem(NAV_PINNED_KEY, JSON.stringify({ activities: false, newChat: true }));
    expect(initialNavPinOverrides(storage)).toEqual({ newChat: true });
  });

  it("everything pinned leaves the collapsible area empty, so folding hides nothing", () => {
    let overrides: NavPinOverrides = {};
    for (const key of navEntryKeysFor(true)) overrides = withNavPinned(overrides, key, true);
    expect(Object.keys(overrides)).toEqual(HARNESS);
    const { collapsible } = splitNavEntries(navEntryKeysFor(true), overrides);
    expect(collapsible).toEqual([]);
    expect(visibleNavKeys(true, true, overrides)).toEqual(navEntryKeysFor(true));
  });

  it("everything collapsible still leaves the Library pinned, and folding shows only it", () => {
    let overrides: NavPinOverrides = {};
    for (const key of navEntryKeysFor(true)) overrides = withNavPinned(overrides, key, false);
    expect(splitNavEntries(navEntryKeysFor(true), overrides).pinned).toEqual(["activities"]);
    expect(visibleNavKeys(true, true, overrides)).toEqual(["activities"]);
  });
});

describe("visibleNavKeys", () => {
  it("expanded shows the viewer's every entry; collapsed leaves only the pinned ones visible and reachable (the sidebar renders the folded rows inert at zero height)", () => {
    expect(visibleNavKeys(false)).toEqual(navEntryKeysFor(true));
    expect(visibleNavKeys(true)).toEqual(PINNED);
    expect(visibleNavKeys(false, false)).toEqual(navEntryKeysFor(false));
    expect(visibleNavKeys(true, false)).toEqual(PINNED);
  });

  it("renders the pinned area first, then the collapsible one", () => {
    const overrides = withNavPinned({}, "plugins", true);
    expect(visibleNavKeys(false, true, overrides)).toEqual([
      "activities",
      "media",
      "plugins",
      "newChat",
      "agents",
      "models",
      "machines",
      "usage",
      "benchmark",
    ]);
    expect(visibleNavKeys(true, true, overrides)).toEqual(["activities", "media", "plugins"]);
  });
});

describe("persisted collapse state (one global localStorage key)", () => {
  it("default is expanded with nothing stored, and reading never writes", () => {
    const s = memoryStorage();
    expect(initialNavGroupCollapsed(s)).toBe(false);
    expect(s.map.size).toBe(0);
  });

  it("toggle → store → a fresh mount-time read restores the collapsed state", () => {
    const s = memoryStorage();
    // Collapse: what the sidebar renders shrinks to the pinned entries and the toggle …
    storeNavGroupCollapsed(true, s);
    expect(s.map.get(NAV_GROUP_COLLAPSED_KEY)).toBe("collapsed");
    // … and a re-mount (initialNavGroupCollapsed is the useState initializer) restores it.
    expect(initialNavGroupCollapsed(s)).toBe(true);
    expect(visibleNavKeys(initialNavGroupCollapsed(s))).toEqual(PINNED);
    // Expand again: the choice round-trips both ways.
    storeNavGroupCollapsed(false, s);
    expect(s.map.get(NAV_GROUP_COLLAPSED_KEY)).toBe("expanded");
    expect(initialNavGroupCollapsed(s)).toBe(false);
    expect(visibleNavKeys(initialNavGroupCollapsed(s))).toEqual(navEntryKeysFor(true));
  });

  it("a stored collapsed state folds the collapsible area only; the pinned entries stay", () => {
    const s = memoryStorage({ [NAV_GROUP_COLLAPSED_KEY]: "collapsed" });
    expect(initialNavGroupCollapsed(s)).toBe(true);
    const shown = visibleNavKeys(initialNavGroupCollapsed(s), true, initialNavPinOverrides(s));
    expect(shown).toEqual(PINNED);
  });

  it("unrecognized stored values fall back to expanded", () => {
    const s = memoryStorage();
    for (const raw of ["", "true", "1", "COLLAPSED", "yes"]) {
      s.map.set(NAV_GROUP_COLLAPSED_KEY, raw);
      expect(initialNavGroupCollapsed(s)).toBe(false);
    }
  });

  it("storage throwing (quota/private mode): store does not throw, read yields the default", () => {
    const broken = blockedStorage();
    expect(() => storeNavGroupCollapsed(true, broken)).not.toThrow();
    expect(initialNavGroupCollapsed(broken)).toBe(false);
  });

  it("storage whose GETTER throws (blocked site data) degrades instead of escaping the useState initializer", () => {
    expect(() => initialNavGroupCollapsed(hostileStorage)).not.toThrow();
    expect(initialNavGroupCollapsed(hostileStorage)).toBe(false);
  });
});

describe("persisted pin choices (one global localStorage key)", () => {
  it("nothing stored reads as no choices — the defaults — and reading never writes", () => {
    const s = memoryStorage();
    expect(initialNavPinOverrides(s)).toEqual({});
    expect(s.map.size).toBe(0);
  });

  it("a move → store → a fresh mount-time read restores the areas", () => {
    const s = memoryStorage();
    const moved = withNavPinned(withNavPinned({}, "media", false), "usage", true);
    storeNavPinOverrides(moved, s);
    expect(JSON.parse(s.map.get(NAV_PINNED_KEY)!)).toEqual({ media: false, usage: true });
    const restored = initialNavPinOverrides(s);
    expect(restored).toEqual(moved);
    expect(splitNavEntries(navEntryKeysFor(true), restored)).toEqual({
      pinned: ["activities", "usage"],
      collapsible: ["media", "newChat", "agents", "models", "plugins", "machines", "benchmark"],
    });
  });

  it("only the deviations are stored: moving back empties the record", () => {
    const s = memoryStorage();
    storeNavPinOverrides(withNavPinned(withNavPinned({}, "models", true), "models", false), s);
    expect(s.map.get(NAV_PINNED_KEY)).toBe("{}");
  });

  it("keys this build does not know are ignored, so a page without a stored choice takes its default", () => {
    const s = memoryStorage({
      [NAV_PINNED_KEY]: JSON.stringify({
        traces: true,
        apps: false,
        models: false,
        machines: true,
      }),
    });
    // machines is admin-only but still a manifest key: an admin's choice survives a member's
    // visit in the same browser.
    expect(initialNavPinOverrides(s)).toEqual({ models: false, machines: true });
  });

  it("a value that is not a boolean is ignored, and the entry keeps its default", () => {
    const s = memoryStorage({
      [NAV_PINNED_KEY]: JSON.stringify({ models: "false", usage: 1, agents: null }),
    });
    expect(initialNavPinOverrides(s)).toEqual({});
  });

  it("unparseable or non-object values read as no choices", () => {
    const s = memoryStorage();
    for (const raw of ["", "{", "null", "[]", '["models"]', "true", "7", '"models"']) {
      s.map.set(NAV_PINNED_KEY, raw);
      expect(initialNavPinOverrides(s), raw).toEqual({});
    }
  });

  it("storage throwing (quota/private mode): store does not throw, read yields the defaults", () => {
    const broken = blockedStorage();
    expect(() => storeNavPinOverrides({ models: false }, broken)).not.toThrow();
    expect(initialNavPinOverrides(broken)).toEqual({});
  });

  it("storage whose GETTER throws degrades instead of escaping the useState initializer", () => {
    expect(() => initialNavPinOverrides(hostileStorage)).not.toThrow();
    expect(initialNavPinOverrides(hostileStorage)).toEqual({});
  });
});
