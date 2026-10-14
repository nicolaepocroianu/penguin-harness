/**
 * Landing ↔ plugin-library sync: the home page's Skills section presents the built-in skills,
 * so every skill that ships in a packages/plugins plugin has to appear in both dictionaries and
 * nothing else may (hook packages are not skills and are not listed there). Derived from the
 * library directories — the same source docs' skills-sync test reads — so shipping a skill
 * without listing it here fails instead of leaving the section quietly short.
 *
 * Membership only, not order and not which card a skill sits in: the categories are the
 * plugin manifests' call, pinned in packages/plugins' own tests, and a reordering inside a card
 * is not a regression worth a red suite.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Strings } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

const pluginsRoot = join(__dirname, "..", "..", "..", "plugins");

/** The skill directories under one plugin's skills/ (a plugin may ship none). */
const skillsOf = (plugin: string): string[] =>
  readdirSync(join(pluginsRoot, plugin, "skills"), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(pluginsRoot, plugin, "skills", entry.name, "SKILL.md")),
    )
    .map((entry) => entry.name);

const pluginDirs = readdirSync(pluginsRoot, { withFileTypes: true }).filter(
  (plugin) => plugin.isDirectory() && existsSync(join(pluginsRoot, plugin.name, "skills")),
);

/** Every skill the library ships. */
const librarySkills = pluginDirs.flatMap((plugin) => skillsOf(plugin.name)).sort();

/**
 * The skills the public site must show: those of every plugin offered to everyone. A plugin
 * whose plugin.json says `preinstall: false` is installed on demand (WAF authoring, Codex
 * delegation and the like): its skills stay in the library and the docs, and the site may
 * name them but need not advertise them.
 */
const advertisedSkills = pluginDirs
  .filter((plugin) => {
    const manifest = join(pluginsRoot, plugin.name, "plugin.json");
    if (!existsSync(manifest)) return true;
    return (
      (JSON.parse(readFileSync(manifest, "utf8")) as { preinstall?: boolean }).preinstall !== false
    );
  })
  .flatMap((plugin) => skillsOf(plugin.name))
  .sort();

/** Every Skill name a dictionary's Skills section renders, flattened across its cards. */
const listedSkills = (dict: Strings): string[] =>
  dict.skills.groups.flatMap((group) => group.skills);

const DICTIONARIES: ReadonlyArray<{ file: string; dict: Strings }> = [
  { file: "strings-en.ts", dict: en },
];

describe("landing ↔ skill library sync", () => {
  it("found the skill library", () => {
    expect(librarySkills.length).toBeGreaterThan(0);
  });

  for (const { file, dict } of DICTIONARIES) {
    it(`${file}'s Skills section lists exactly the library`, () => {
      const listed = listedSkills(dict);
      expect(
        advertisedSkills.filter((name) => !listed.includes(name)),
        `Skills offered to everyone but missing from ${file}`,
      ).toEqual([]);
      expect(
        listed.filter((name) => !librarySkills.includes(name)).sort(),
        `Skills listed in ${file} that no longer ship`,
      ).toEqual([]);
    });

    it(`${file} names each Skill once`, () => {
      const listed = listedSkills(dict);
      expect(
        listed.filter((name, index) => listed.indexOf(name) !== index).sort(),
        `Skills listed in more than one group in ${file}`,
      ).toEqual([]);
    });
  }

  /**
   * Card by card rather than as one flat list: the two dictionaries render the same cards
   * in the same order, so a Skill that moves card in one language and not the other is drift a
   * flattened comparison cannot see. Membership inside a card only — the chips are free to be
   * reordered.
   */
});
