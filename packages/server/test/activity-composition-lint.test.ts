/**
 * The static read of a scene composition. What this proves: a page written the way the skill asks
 * passes clean; randomness and the clock, the page's own timers, endless repeats, layout tweens,
 * emoji, all-caps text, small type and filler copy are each found once, with the piece of source
 * they were found in; and each finding is worded as an instruction to the agent.
 */
import { describe, expect, it } from "vitest";
import { lintComposition, lintForAgent } from "../src/activities/composition-lint.js";

const page = (body: string, script: string, style = "") => `<!doctype html><html><head>
<style>#stage { width: 640px; } ${style}</style>
<script src="gsap.min.js"></script><script src="penguin-composition.js"></script></head>
<body><div id="stage">${body}</div>
<script>const timeline = gsap.timeline({ paused: true }); ${script} window.__composition.timeline = timeline;</script>
</body></html>`;

describe("composition lint", () => {
  it("passes a page written the way the skill asks", () => {
    expect(
      lintComposition(
        page(
          '<p id="title" style="font-size:32px">Find the treasure</p><svg><text>X</text></svg>',
          'timeline.fromTo("#title", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.6 });',
        ),
      ),
    ).toEqual([]);
  });

  it("finds each kind of trouble once, with where it was", () => {
    const codes = (body: string, script = "", style = "") =>
      lintComposition(page(body, script, style)).map((finding) => finding.code);
    expect(codes("", "const x = Math.random(); const y = Math.random();")).toEqual([
      "nondeterministic",
    ]);
    expect(codes("", "setTimeout(() => {}, 100);")).toEqual(["own_timers"]);
    expect(codes("", 'timeline.to("#sun", { rotation: 360, repeat: -1 });')).toEqual([
      "endless_repeat",
    ]);
    expect(codes("", 'timeline.to("#chest", { width: 200, duration: 1 });')).toEqual([
      "layout_tween",
    ]);
    expect(codes("<p>Treasure 🏴‍☠️</p>")).toEqual(["emoji"]);
    expect(codes("<p>FIND THE LETTER</p>")).toEqual(["all_caps"]);
    expect(codes("<p>Find it</p>", "", "p { text-transform: uppercase; }")).toEqual(["all_caps"]);
    expect(codes("<p>Find it</p>", "", "p { font-size: 18px; }")).toEqual(["small_font"]);
    expect(codes("<p>Lorem ipsum dolor</p>")).toEqual(["filler"]);
    const [finding] = lintComposition(page("", 'timeline.to("#chest", { left: 40 });'));
    expect(finding!.snippet).toContain("left: 40");
  });

  it("words each finding as an instruction to the agent", () => {
    expect(lintForAgent({ code: "emoji", snippet: "Treasure 🏴‍☠️" })).toBe(
      "The scene uses an emoji (Treasure 🏴‍☠️): draw it with SVG or CSS, since emoji look different on every machine.",
    );
    expect(lintForAgent({ code: "small_font", snippet: "font-size: 18px" })).toContain(
      "at least 28px",
    );
  });
});
