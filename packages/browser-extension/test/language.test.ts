/**
 * The extension's copy and its listing are English only.
 *
 * - Given the options page and the popup, whatever language Chrome is in, all their copy is
 *   English and neither offers a language switch.
 * - Given the manifest's localized name and description, every message it names exists in the
 *   one locale the package ships, which is the default, within the Chrome Web Store's lengths.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installChrome } from "./helpers/chrome.js";
import { openPage } from "./helpers/dom.js";

const HAN = /\p{Script=Han}/u;

beforeEach(() => {
  installChrome();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the pages' copy", () => {
  it.each(["pair", "popup"] as const)(
    "the %s page is in English with no language switch",
    async (name) => {
      const page = await openPage(name);

      expect(page.text()).not.toBe("");
      expect(page.text()).not.toMatch(HAN);
      expect(() => page.byId("language")).toThrow();
      expect(page.byId("theme").title).toBe("Theme: System");
    },
  );

  it("the options page reads in English", async () => {
    const page = await openPage("pair");

    expect(page.byId("heading").textContent).toBe("PenguinHarness Browser");
    expect(page.byId("add-title").textContent).toBe("Add a server");
  });
});

describe("the manifest's localized name and description", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8")) as Record<
    string,
    unknown
  >;
  const locales = readdirSync(path.join(root, "_locales"));
  const messages = (locale: string) =>
    JSON.parse(
      readFileSync(path.join(root, "_locales", locale, "messages.json"), "utf8"),
    ) as Record<string, { message?: string }>;
  const named = [...JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)].map(([, key]) => key!);

  it("ships English only, and names messages that it has", () => {
    expect(manifest.default_locale).toBe("en");
    expect(locales).toEqual(["en"]);
    expect(named).toEqual(expect.arrayContaining(["extName", "extDescription"]));
    for (const key of named) expect(messages("en")[key]?.message, key).toBeTruthy();
  });

  it("keeps the name and description within the Store's limits", () => {
    const table = messages("en");
    expect(table.extName!.message!.length).toBeLessThanOrEqual(75);
    expect(table.extDescription!.message!.length).toBeLessThanOrEqual(132);
  });
});
