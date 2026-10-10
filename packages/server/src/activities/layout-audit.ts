/**
 * The layout audit of a scene composition (experimental, behind `activityVideoExperiment`): while
 * the composition is recorded (see video-render.ts), the page is measured at a few moments of its
 * timeline for what learners would see wrong.
 *
 * - Two main objects (elements the agent marks `data-focal`) covering each other by more than a
 *   tenth of the smaller one, unless either is marked `data-allow-overlap` or holds the other.
 * - A main object reaching more than 2px outside the stage.
 * - Visible text smaller than `SMALL_TEXT_PX`.
 * - Visible text whose contrast with what is behind it is under WCAG's minimum: 4.5:1, or 3:1
 *   for large text (24px and up). What is behind it is the nearest solid background colour of
 *   the text or its containers, or every colour stop of a background gradient there, the worst
 *   one counting. A shape painted behind the text by another element is not seen.
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
/** WCAG's minimum contrast for text, and for large text. */
export const MIN_CONTRAST = 4.5;
export const MIN_CONTRAST_LARGE = 3;

/** How many moments of the timeline are measured. */
export const AUDIT_SAMPLES = 5;

/** What the page reports at one moment. */
export interface LayoutSample {
  overlap: string[][];
  offStage: string[];
  smallText: string[];
  /** Absent from pages measured before contrast was. */
  lowContrast?: string[];
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
  function rgba(value) {
    // Character classes rather than escapes: this script is a template string, which drops
    // the backslash of an escaped bracket.
    var match = /rgba?[(]([^)]+)[)]/.exec(value || "");
    if (!match) return null;
    var parts = match[1].split(/[ ,/]+/).filter(Boolean).map(parseFloat);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }
  function luminance(c) {
    function channel(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  }
  function contrast(a, b) {
    var x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function behind(el) {
    for (var node = el; node; node = node.parentElement) {
      var style = getComputedStyle(node), colors = [];
      if (style.backgroundImage && style.backgroundImage !== "none")
        (style.backgroundImage.match(/rgba?[(][^)]+[)]/g) || []).forEach(function (stop) {
          var c = rgba(stop); if (c && c.a >= 0.5) colors.push(c);
        });
      var solid = rgba(style.backgroundColor);
      if (solid && solid.a >= 0.5) colors.push(solid);
      if (colors.length) return colors;
      if (node === stage) break;
    }
    return [{ r: 255, g: 255, b: 255, a: 1 }];
  }
  var walker = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT);
  var small = new Set(), faint = new Set();
  for (var text = walker.nextNode(); text; text = walker.nextNode()) {
    var el = text.parentElement;
    if (!el || !text.textContent.trim() || !seen(el)) continue;
    // SVG text is drawn in its viewBox's units, so its size on screen is read off its box.
    var size = el instanceof SVGElement
      ? el.getBoundingClientRect().height / 1.2
      : parseFloat(getComputedStyle(el).fontSize);
    if (size && size < ${SMALL_TEXT_PX}) small.add(name(el));
    var ink = rgba(el instanceof SVGElement ? getComputedStyle(el).fill : getComputedStyle(el).color);
    if (ink && ink.a >= 0.5) {
      var least = Math.min.apply(null, behind(el).map(function (c) { return contrast(ink, c); }));
      if (least < (size >= 24 ? ${MIN_CONTRAST_LARGE} : ${MIN_CONTRAST})) faint.add(name(el));
    }
  }
  var lowContrast = [];
  small.forEach(function (n) { smallText.push(n); });
  faint.forEach(function (n) { lowContrast.push(n); });
  return { overlap: overlap, offStage: offStage, smallText: smallText, lowContrast: lowContrast };
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
    for (const element of sample.lowContrast ?? []) note("low_contrast", [element], atMs);
  }
  return [...found.values()];
}
