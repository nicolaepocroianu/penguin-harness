/**
 * The reflection cycle's change check (scripts/activity-reflection/check-change.mjs), run as a
 * reviewer runs it: the write set (an existing skill's files, a prompt module, the plugin's
 * version), frontmatter that stays put, and no character a reviewer cannot see — which the
 * printed word diff shows as <U+XXXX>.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(
  import.meta.dirname,
  "../../../scripts/activity-reflection/check-change.mjs",
);
const SKILL = "plugins/waf-authoring/skills/waf-audio-patterns/SKILL.md";
const SKILL_TEXT =
  "---\nname: waf-audio-patterns\ndescription: Use when wiring audio.\n---\n\n# Audio\n\nPlay narration first.\n";
const PROMPT = "packages/server/src/activities/prompts/module.ts";
const PROMPT_TEXT = 'export const MODULE_RULES = "Build the module.";\n';
const PLUGIN = "plugins/waf-authoring/plugin.json";
const pluginJson = (version: string, description = "WAF authoring.") =>
  `${JSON.stringify({ description, version }, null, 2)}\n`;

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reflection-check-"));
  temps.push(dir);
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=R",
        "-c",
        "user.email=r@example.invalid",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  const commit = (files: Record<string, string | null>) => {
    for (const [file, text] of Object.entries(files)) {
      const full = path.join(dir, file);
      if (text === null) fs.rmSync(full);
      else {
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, text);
      }
    }
    git("add", "-A", "--", ".");
    git("commit", "-q", "-m", "change");
    return git("rev-parse", "HEAD");
  };
  git("init", "-q", "-b", "main");
  git("config", "core.autocrlf", "false");
  const base = commit({
    [SKILL]: SKILL_TEXT,
    [PROMPT]: PROMPT_TEXT,
    [PLUGIN]: pluginJson("2026.10.10.1"),
    "packages/server/src/activities/collect.ts": "export {};\n",
  });
  const check = (head: string, from = base) => {
    const run = spawnSync(process.execPath, [SCRIPT, from, head], { cwd: dir, encoding: "utf8" });
    return { code: run.status, out: run.stdout, err: run.stderr };
  };
  return { commit, check, git, base };
}

describe("the reflection cycle's change check", () => {
  it("passes a skill body edit and a prompt's text, with the plugin's version raised", () => {
    const r = repo();
    const head = r.commit({
      [SKILL]: SKILL_TEXT.replace(
        "Play narration first.",
        "Play narration first, then wait for it.",
      ),
      [PROMPT]: PROMPT_TEXT.replace("Build the module.", "Build and check the module."),
      [PLUGIN]: pluginJson("2026.10.13.1"),
    });
    const { code, out } = r.check(head);
    expect(code).toBe(0);
    expect(out).toContain("[-first.-]{+first, then wait for it.+}");
    expect(out).toContain("The change holds: 3 file(s) in the write set, nothing hidden.");
  });

  it("shows and refuses a character a reviewer cannot see", () => {
    const hidden: [string, string, string][] = [
      // A right-to-left override and a zero-width space.
      [
        "Play narration \u202Etsrif\u202C\u200B first.",
        "<U+202E>tsrif<U+202C><U+200B>",
        "<U+202E> <U+202C> <U+200B>",
      ],
      // A soft hyphen.
      ["Play narra\u00ADtion first.", "narra<U+00AD>tion", "<U+00AD>"],
      // Tag characters spelling "Hi": the block that can carry a hidden prompt.
      [
        "Play narration first.\u{E0048}\u{E0069}",
        "first.<U+E0048><U+E0069>",
        "<U+E0048> <U+E0069>",
      ],
      // A variation selector beyond the format class.
      ["Play narration\u{E0100} first.", "narration<U+E0100>", "<U+E0100>"],
    ];
    for (const [text, shown, listed] of hidden) {
      const r = repo();
      const head = r.commit({ [SKILL]: SKILL_TEXT.replace("Play narration first.", text) });
      const { code, out, err } = r.check(head);
      expect(code, listed).toBe(1);
      expect(out, listed).toContain(shown);
      expect(err, listed).toContain(`${SKILL}:8: invisible or direction-changing ${listed}`);
    }
  });

  it("shows hidden characters around a change, and refuses only what the change adds", () => {
    const r = repo();
    // Already there before the change, on the line above the one it changes.
    const before = SKILL_TEXT.replace("# Audio", "# Au\u00ADdio");
    const base = r.commit({ [SKILL]: before });
    const head = r.commit({
      [SKILL]: before.replace("Play narration first.", "Play narration first, then wait."),
    });
    const { code, out } = r.check(head, base);
    expect(code).toBe(0);
    expect(out).toContain("# Au<U+00AD>dio");
  });

  it("refuses frontmatter, files outside the write set, new files and other manifest fields", () => {
    const cases: [Record<string, string | null>, string][] = [
      [
        { [SKILL]: SKILL_TEXT.replace("Use when wiring audio.", "Use always.") },
        `${SKILL}: its frontmatter (name, description) may not change.`,
      ],
      [
        { "packages/server/src/activities/collect.ts": "export const loosened = true;\n" },
        "packages/server/src/activities/collect.ts: outside the write set",
      ],
      [
        { "plugins/waf-authoring/skills/waf-new/SKILL.md": SKILL_TEXT },
        "plugins/waf-authoring/skills/waf-new/SKILL.md: may only be changed in place",
      ],
      [{ [PROMPT]: null }, `${PROMPT}: may only be changed in place`],
      [
        { [PLUGIN]: pluginJson("2026.10.13.1", "Better.") },
        `${PLUGIN}: only its version may change.`,
      ],
    ];
    for (const [files, problem] of cases) {
      const r = repo();
      const { code, err } = r.check(r.commit(files));
      expect(code, problem).toBe(1);
      expect(err, problem).toContain(problem);
    }
  });

  it("takes two commits and nothing else", () => {
    const run = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(run.status).toBe(64);
  });
});
