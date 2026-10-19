/**
 * The breadcrumb spells an address from names the caller passes in, already worded.
 */
import { describe, expect, it } from "vitest";
import { formatBreadcrumb } from "../src/lib/breadcrumb";
import { en } from "../src/strings-en";

describe("formatBreadcrumb", () => {
  it("spells a surface's address: theme › surface, then the mode", () => {
    expect(
      formatBreadcrumb({
        theme: en.rail.themeNames.modern,
        page: en.surfaces.chat.title,
        mode: en.crumb.modes.dark,
        size: "m",
      }),
    ).toBe("Frost › Chat · dark");
  });

  it("names the themes by their display names", () => {
    expect(en.rail.themeNames).toEqual({ github: "Primer", modern: "Frost", geek: "Console" });
  });

  it("names a section of a page, the section joining the path", () => {
    expect(
      formatBreadcrumb({
        theme: "Console",
        page: "Foundations",
        section: "Colour",
        mode: "dark",
        size: "m",
      }),
    ).toBe("Console › Foundations › Colour · dark");
  });

  it("appends the accent, the root size and the phone frame only when they differ from the defaults", () => {
    expect(
      formatBreadcrumb({
        theme: "Primer",
        page: "Models",
        mode: "dark",
        accent: "amber",
        size: "xl",
        view: "phone",
      }),
    ).toBe("Primer › Models · dark · amber · 20px · phone");
    expect(
      formatBreadcrumb({
        theme: "Primer",
        page: "Models",
        mode: "dark",
        size: "xs",
        view: "phone",
      }),
    ).toBe("Primer › Models · dark · 14px · phone");
    expect(formatBreadcrumb({ theme: "Primer", page: "Models", mode: "light", size: "m" })).toBe(
      "Primer › Models · light",
    );
  });
});
