#!/usr/bin/env node
/**
 * Checks a reflection cycle's change before it is scored or proposed
 * (.agents/skills/activity-reflection/SKILL.md), and shows it the way a reviewer must read it.
 *
 * Usage: node scripts/activity-reflection/check-change.mjs <base> [<head>]   (head: HEAD)
 *
 * 1. Every changed file is in the Reflector's write set (decision 15):
 *    - an existing file of an existing skill under plugins/waf-authoring/skills/, changed in
 *      place (no file added, removed or turned into a link), and a SKILL.md keeps its
 *      frontmatter byte for byte but its dated `version` line: its name and description sit in
 *      the agent's system prefix, and a changed skill must raise its own version;
 *    - an existing stage prompt module under packages/server/src/activities/prompts/, changed
 *      in place (the bench refuses anything there but a change of its literals' text);
 *    - the plugin's package.json (and a plugin.json, which plugins no longer carry), in their
 *      `version` only.
 * 2. No added line holds a character that is invisible or turns text around (HIDDEN below:
 *    every format, control, private-use and separator character, and the invisible marks and
 *    fillers beyond them). Text that reads one way to a reviewer and another to a model is how
 *    a change hides what it does.
 * 3. Prints the change as a word diff with every such character shown as <U+XXXX> — in the lines
 *    it changes and in the lines around them alike; only added lines are refused for them.
 *
 * Exit 0 when the change holds, 1 when it does not (each reason printed), 64 on usage.
 */
import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";

const SKILLS = "plugins/waf-authoring/skills/";
const PROMPTS = "packages/server/src/activities/prompts/";
const MANIFESTS = ["plugins/waf-authoring/plugin.json", "plugins/waf-authoring/package.json"];
/**
 * Characters a reviewer cannot see or that turn text around: every format, control, private-use,
 * line- and paragraph-separator character (soft hyphen, zero-width and joiner characters,
 * direction marks, embeddings, overrides and isolates, the tag block that can spell a hidden
 * prompt, interlinear annotations), plus the invisible marks and fillers outside those classes
 * (combining grapheme joiner, Hangul fillers, Khmer vowels, Mongolian selectors, variation
 * selectors). Tab, line feed and carriage return are text.
 */
const HIDDEN =
  /(?![\t\n\r])[\p{Cf}\p{Cc}\p{Co}\p{Zl}\p{Zp}\u034F\u115F\u1160\u17B4\u17B5\u180B-\u180D\u3164\uFFA0\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu;

const [base, head = "HEAD", ...extra] = process.argv.slice(2);
if (!base || extra.length) {
  console.error("Use: node scripts/activity-reflection/check-change.mjs <base> [<head>]");
  process.exit(64);
}

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const show = (sha, file) => {
  try {
    return git("show", `${sha}:${file}`);
  } catch {
    return null;
  }
};
const visible = (text) =>
  text.replace(
    HIDDEN,
    (char) => `<U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}>`,
  );
/** A SKILL.md's frontmatter without its `version` line, which a changed skill raises. */
const frontmatter = (text) =>
  (/^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(text)?.[0] ?? "").replace(/^version\s*:.*\r?\n/m, "");
const withoutVersion = (text) => {
  try {
    const { version: _version, ...rest } = JSON.parse(text);
    return rest;
  } catch {
    return null;
  }
};

const problems = [];
// Each changed file: `:<mode before> <mode after> <blob> <blob> <status>`, then its path.
const parts = git("diff", "--raw", "-z", "--no-renames", "--no-abbrev", base, head).split("\0");
const changed = [];
for (let i = 0; i + 1 < parts.length; i += 2) {
  const header = /^:(\d{6}) (\d{6}) \S+ \S+ (\S+)$/.exec(parts[i]);
  if (header)
    changed.push({ before: header[1], after: header[2], status: header[3], file: parts[i + 1] });
}
if (!changed.length) problems.push("Nothing changed between the two commits.");

for (const { before, after, status, file } of changed) {
  const inPlace = status === "M" && before === after && !["120000", "160000"].includes(after);
  if (MANIFESTS.includes(file)) {
    const [old, now] = [
      withoutVersion(show(base, file) ?? ""),
      withoutVersion(show(head, file) ?? ""),
    ];
    if (!inPlace || old === null || now === null || !isDeepStrictEqual(old, now))
      problems.push(`${file}: only its version may change.`);
    continue;
  }
  const skill = file.startsWith(SKILLS) && file.slice(SKILLS.length).includes("/");
  const prompt = file.startsWith(PROMPTS) && /^[a-z-]+\.ts$/.test(file.slice(PROMPTS.length));
  if (!skill && !prompt) {
    problems.push(`${file}: outside the write set (a skill's files, a prompt module's text).`);
    continue;
  }
  if (!inPlace) {
    problems.push(`${file}: may only be changed in place, not added, removed or relinked.`);
    continue;
  }
  if (skill && file.endsWith("/SKILL.md")) {
    const [old, now] = [frontmatter(show(base, file) ?? ""), frontmatter(show(head, file) ?? "")];
    if (old !== now) problems.push(`${file}: its frontmatter (name, description) may not change.`);
  }
}

// What the change adds, line by line, for characters a reviewer cannot see.
let file = "";
let line = 0;
for (const text of git("diff", "-U0", "--no-color", base, head).split("\n")) {
  if (text.startsWith("+++ ")) file = text.slice(text.startsWith("+++ b/") ? 6 : 4);
  const hunk = /^@@ -\S+ \+(\d+)/.exec(text);
  if (hunk) line = Number(hunk[1]) - 1;
  if (text.startsWith("+") && !text.startsWith("+++")) {
    line++;
    const found = text.match(HIDDEN);
    if (found)
      problems.push(
        `${file}:${line}: invisible or direction-changing ${[...new Set(found)].map((char) => visible(char)).join(" ")}`,
      );
  }
}

console.log(visible(git("diff", "--word-diff=plain", "--no-color", base, head)));
if (problems.length) {
  console.error(`\nThe change does not hold:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`The change holds: ${changed.length} file(s) in the write set, nothing hidden.`);
