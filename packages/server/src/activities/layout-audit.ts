/**
 * The layout audit of a scene composition (experimental, behind `activityVideoExperiment`): while
 * the composition is recorded (see video-render.ts), the page is measured at a few moments of its
 * timeline for what learners would see wrong.
 *
 * - Two main objects (elements the agent marks `data-focal`) covering each other by more than a
 *   tenth of the smaller one, unless either is marked `data-allow-overlap` or holds the other.
 * - A main object reaching more than 2px outside the stage.
 * - Visible text smaller than `SMALL_TEXT_PX`.
 *
 * An element too faint to see (opacity under 0.05, all the way up) is not measured. Each finding
 * says which elements and from when to when it was seen; it joins the video's final check (see
 * video-check.ts) as a warning, since a measurement cannot know what the author meant.
 *
 * The idea follows HeyGen HyperFrames' `check` command (Apache-2.0), which seeks a composition at
 * sampled times and audits overlap, off-canvas content and text; this is Penguin's own, smaller
 * version of it.
 */
import type { VideoCheckFinding } from "./video-types.js";

/** Text smaller than this, in stage pixels, is too small for learners on a small screen. */
export const SMALL_TEXT_PX = 28;
/** How many moments of the timeline are measured. */
export const AUDIT_SAMPLES = 5;

/** What the page reports at one moment. */
export interface LayoutSample {
  overlap: string[][];
  offStage: string[];
  smallText: string[];
}

/**
 * The moments to measure, as frame indexes: spread evenly from the first frame to the last, so
 * the opening still and the closing one are both seen.
 */
export function auditFrames(frames: number): Set<number> {
  const picked = new Set<number>();
  if (frames <= 0) return picked;
  for (let index = 0; index < AUDIT_SAMPLES; index += 1)
    picked.add(Math.round(((frames - 1) * index) / (AUDIT_SAMPLES - 1)));
  return picked;
}

/** Measures the page as it is painted now; answers a `LayoutSample`. Runs inside the page. */
export const AUDIT_SCRIPT = `(function () {
  var stage = document.getElementById("stage");
  if (!stage) return { overlap: [], offStage: [], smallText: [] };
  var bounds = stage.getBoundingClientRect();
  function seen(el) {
    for (var node = el; node && node !== document.documentElement; node = node.parentElement) {
      var style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    var opacity = 1;
    for (var up = el; up && up !== document.documentElement; up = up.parentElement)
      opacity *= parseFloat(getComputedStyle(up).opacity || "1");
    return opacity >= 0.05;
  }
  function name(el) { return el.id ? "#" + el.id : el.tagName.toLowerCase(); }
  var focal = Array.prototype.filter.call(stage.querySelectorAll("[data-focal]"), function (el) {
    var box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && seen(el);
  });
  var overlap = [], offStage = [], smallText = [];
  focal.forEach(function (el) {
    var box = el.getBoundingClientRect();
    if (box.left < bounds.left - 2 || box.top < bounds.top - 2 ||
        box.right > bounds.right + 2 || box.bottom > bounds.bottom + 2) offStage.push(name(el));
  });
  for (var i = 0; i < focal.length; i += 1)
    for (var j = i + 1; j < focal.length; j += 1) {
      var a = focal[i], b = focal[j];
      if (a.contains(b) || b.contains(a)) continue;
      if (a.hasAttribute("data-allow-overlap") || b.hasAttribute("data-allow-overlap")) continue;
      var p = a.getBoundingClientRect(), q = b.getBoundingClientRect();
      var w = Math.min(p.right, q.right) - Math.max(p.left, q.left);
      var h = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
      var smaller = Math.min(p.width * p.height, q.width * q.height);
      if (w > 0 && h > 0 && w * h > smaller * 0.1) overlap.push([name(a), name(b)]);
    }
  var walker = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT);
  var small = new Set();
  for (var text = walker.nextNode(); text; text = walker.nextNode()) {
    var el = text.parentElement;
    if (!el || !text.textContent.trim() || !seen(el)) continue;
    // SVG text is drawn in its viewBox's units, so its size on screen is read off its box.
    var size = el instanceof SVGElement
      ? el.getBoundingClientRect().height / 1.2
      : parseFloat(getComputedStyle(el).fontSize);
    if (size && size < ${SMALL_TEXT_PX}) small.add(name(el));
  }
  small.forEach(function (n) { smallText.push(n); });
  return { overlap: overlap, offStage: offStage, smallText: smallText };
})()`;

/** Whether a page's answer is a `LayoutSample`; anything else is no measurement. */
function isSample(value: unknown): value is LayoutSample {
  const sample = value as LayoutSample | null;
  return (
    !!sample &&
    Array.isArray(sample.overlap) &&
    Array.isArray(sample.offStage) &&
    Array.isArray(sample.smallText)
  );
}

/**
 * The findings of the measured moments, each thing found once: which elements, and from the first
 * moment it was seen to the last.
 */
export function layoutFindings(samples: { atMs: number; sample: unknown }[]): VideoCheckFinding[] {
  const found = new Map<string, VideoCheckFinding>();
  const note = (code: VideoCheckFinding["code"], elements: string[], atMs: number) => {
    const key = `${code}:${elements.join(",")}`;
    const seen = found.get(key);
    if (seen) seen.endMs = atMs;
    else found.set(key, { code, severity: "warning", elements, startMs: atMs, endMs: atMs });
  };
  for (const { atMs, sample } of samples) {
    if (!isSample(sample)) continue;
    for (const pair of sample.overlap) note("layout_overlap", [...pair].sort(), atMs);
    for (const element of sample.offStage) note("off_stage", [element], atMs);
    for (const element of sample.smallText) note("small_text", [element], atMs);
  }
  return [...found.values()];
}
