/**
 * A static read of an agent-written scene composition (experimental, behind
 * `activityVideoExperiment`), before it is ever recorded: what in its source will look wrong to a
 * young learner or break a frame-by-frame recording. Every finding is a warning: the composition
 * is still kept, and the studio shows the findings beside it; composing again hands them to the
 * agent to fix (see `findingForAgent`).
 *
 * What it looks for:
 * - **Determinism.** `Math.random`, `Date.now`, `performance.now`, the page's own timers or
 *   animation frames, and endless repeats. The recorder seeks the timeline, so anything driven
 *   by time outside it differs from frame to frame and run to run.
 * - **Layout tweens.** Tweening `width`, `height`, `top` or `left` instead of transforms.
 * - **Emoji.** They are drawn by each machine's own emoji font, so the scene looks different
 *   wherever it is recorded.
 * - **All-caps text.** Harder for early readers to read than mixed case.
 * - **Small type.** A CSS `font-size` under 28px.
 * - **Filler copy.** Lorem ipsum, "placeholder", TODO.
 *
 * The approach, a quick source lint whose findings go back to the agent, follows open-design's
 * artifact linter (`apps/daemon/src/lint-artifact.ts` in github.com/nexu-io/open-design,
 * Apache-2.0). Its rules there are about marketing pages; the ones here are Penguin's own for
 * scenes, with the filler and emoji checks adapted from it.
 */
import type { CompositionLintCode, CompositionLintFinding } from "./composition-types.js";

const SMALL_FONT_PX = 28;

/** A short piece of the source around a match, for the author and the agent to find it by. */
function snippet(source: string, index: number, length: number): string {
  const start = Math.max(0, index - 20);
  return source
    .slice(start, Math.min(source.length, index + length + 20))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

/** The scripts of a page, joined. */
function scriptsOf(html: string): string {
  return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1] ?? "")
    .join("\n");
}

/** The visible text of a page: its markup with scripts, styles and tags removed. */
function textOf(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
}

/** What the composition's source suggests will go wrong, first finding of each kind. */
export function lintComposition(html: string): CompositionLintFinding[] {
  const findings: CompositionLintFinding[] = [];
  const once = (code: CompositionLintCode, source: string, match: RegExpExecArray | null) => {
    if (match && !findings.some((finding) => finding.code === code))
      findings.push({ code, snippet: snippet(source, match.index, match[0].length) });
  };
  const scripts = scriptsOf(html);
  once(
    "nondeterministic",
    scripts,
    /\bMath\.random\s*\(|\bDate\.now\s*\(|\bperformance\.now\s*\(|\bnew\s+Date\s*\(/.exec(scripts),
  );
  once(
    "own_timers",
    scripts,
    /\b(?:setTimeout|setInterval|requestAnimationFrame)\s*\(/.exec(scripts),
  );
  once("endless_repeat", scripts, /\brepeat\s*:\s*-\s*1\b/.exec(scripts));
  once(
    "layout_tween",
    scripts,
    /\.(?:to|from|fromTo|set)\s*\([^;]*?[{,]\s*["']?(?:width|height|top|left)["']?\s*:/.exec(
      scripts,
    ),
  );
  const text = textOf(html);
  once("emoji", text, /\p{Extended_Pictographic}/u.exec(text));
  once("all_caps", text, /\b[A-Z]{4,}(?:\s+[A-Z]{2,})*\b/.exec(text));
  once("all_caps", html, /text-transform\s*:\s*uppercase/i.exec(html));
  const small = [...html.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/gi)].find(
    (match) => Number(match[1]) < SMALL_FONT_PX,
  );
  if (small) once("small_font", html, small as RegExpExecArray);
  once("filler", text, /\blorem ipsum\b|\bplaceholder\b|\bTODO\b|\bTBD\b/i.exec(text));
  return findings;
}

/** A lint finding as an instruction to the agent composing the scene again. */
export function lintForAgent(finding: CompositionLintFinding): string {
  const at = ` (${finding.snippet})`;
  switch (finding.code) {
    case "nondeterministic":
      return `The page reads randomness or the clock${at}: drive everything from the paused timeline, the same every time.`;
    case "own_timers":
      return `The page runs its own timers or animation frames${at}: drive every change from the timeline instead.`;
    case "endless_repeat":
      return `A tween repeats forever${at}: give it a finite repeat inside the timeline's length.`;
    case "layout_tween":
      return `A tween animates width, height, top or left${at}: animate x, y, scale or opacity instead.`;
    case "emoji":
      return `The scene uses an emoji${at}: draw it with SVG or CSS, since emoji look different on every machine.`;
    case "all_caps":
      return `Text is in capitals${at}: use mixed case, which young readers read more easily.`;
    case "small_font":
      return `A font size is under ${SMALL_FONT_PX}px${at}: make text at least ${SMALL_FONT_PX}px.`;
    case "filler":
      return `The scene has filler text${at}: write the real words or leave the text out.`;
  }
}
