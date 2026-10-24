/**
 * The web app's page manifest (src/module.json) and how server contributions fold in
 * (lib/pages.ts).
 *
 * - Every nav key the JSON manifest names has a nav label and an icon (the JSON is not
 *   type-checked against them).
 * - Every page has a unique id, key and path, and a renderer.
 * - A member's nav drops admin-only and unreleased pages and adds nothing the admin lacks.
 * - A server page whose renderer this build carries is appended after the local ones.
 * - A server page with an unknown builtin renderer is skipped, and a local page wins over a
 *   same-key server one.
 * - An iframe renderer needs no registry entry.
 * - A nav entry leads to its path without parameters, the app opens on the Library, and a path
 *   lights the longest entry it is under.
 */
import { describe, expect, it } from "vitest";
import {
  HOME_PATH,
  NAV_PAGE_KEYS,
  PAGES,
  currentNavKey,
  mergePages,
  navHref,
  navPagesFor,
} from "../src/lib/pages";
import { en } from "../src/lib/strings-en";
import { NAV_ICONS } from "../src/lib/nav-icons";

describe("the page manifest", () => {
  it("names only keys the nav strings and icons are typed for", () => {
    for (const key of NAV_PAGE_KEYS) {
      expect(en.nav).toHaveProperty(key);
      expect(NAV_ICONS).toHaveProperty(key);
    }
  });

  it("every page has a unique id, key and path, and a renderer", () => {
    const ids = new Set(PAGES.map((p) => p.id));
    expect(ids.size).toBe(PAGES.length);
    expect(new Set(PAGES.map((p) => p.key)).size).toBe(PAGES.length);
    expect(new Set(PAGES.map((p) => p.path)).size).toBe(PAGES.length);
    for (const page of PAGES)
      expect("builtin" in page.renderer || "iframe" in page.renderer).toBe(true);
  });

  it("the nav a member sees drops admin-only and unreleased pages", () => {
    const admin = navPagesFor(true).map((p) => p.key);
    const member = navPagesFor(false).map((p) => p.key);
    expect(admin).toContain("machines"); // released, and admin-only
    expect(member).not.toContain("machines");
    expect(member.every((key) => admin.includes(key))).toBe(true);
    for (const page of PAGES.filter((p) => p.nav === "main" && p.admin))
      expect(member).not.toContain(page.key);
  });
});

describe("mergePages", () => {
  const known = new Set(["AgentsPage", "UsagePage"]);

  it("adds a server page whose renderer this build carries, after the local ones", () => {
    const merged = mergePages(
      PAGES,
      [
        {
          id: "x.reports",
          key: "reports",
          path: "/reports",
          nav: "main",
          renderer: { builtin: "UsagePage" },
        },
      ],
      known,
    );
    expect(merged.at(-1)).toMatchObject({
      key: "reports",
      path: "/reports",
      nav: "main",
      admin: false,
      released: true,
    });
  });

  it("skips a page with an unknown builtin renderer, and keeps a local page over a same-key remote one", () => {
    const merged = mergePages(
      PAGES,
      [
        { key: "later", path: "/later", renderer: { builtin: "NotBuiltHere" } },
        { key: "agents", path: "/elsewhere", renderer: { builtin: "AgentsPage" } },
      ],
      known,
    );
    expect(merged.map((p) => p.key)).toEqual(PAGES.map((p) => p.key));
  });

  it("an iframe renderer needs no registry entry", () => {
    const merged = mergePages(
      [],
      [
        {
          key: "wf",
          path: "/wf",
          renderer: { iframe: { src: "/workbench/a/wf/", namespace: "wf" } },
        },
      ],
      known,
    );
    expect(merged).toHaveLength(1);
  });
});

describe("navHref and currentNavKey", () => {
  it("an entry leads to its page's path without the parameter segments", () => {
    expect(navHref("activities")).toBe("/activities");
    expect(navHref("media")).toBe("/activities/media");
    expect(navHref("agents")).toBe("/agents");
    expect(navHref("unknown")).toBe("/unknown");
  });

  it("the app opens on the Library", () => {
    expect(HOME_PATH).toBe(navHref("activities"));
  });

  it("a path lights the longest entry it is under, and none when it is under no entry", () => {
    const keys = ["activities", "media", "agents"];
    expect(currentNavKey("/activities", keys)).toBe("activities");
    expect(currentNavKey("/activities/abc123", keys)).toBe("activities");
    expect(currentNavKey("/activities/media", keys)).toBe("media");
    expect(currentNavKey("/agents/a1", keys)).toBe("agents");
    expect(currentNavKey("/activitiesx", keys)).toBe(null);
    expect(currentNavKey("/chat/new", keys)).toBe(null);
  });
});
