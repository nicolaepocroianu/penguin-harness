---
name: waf-style-guardrails
description: Use when implementing or updating styles for pipeline-generated WAF HTML activities. Keep layouts safe for a parent-provided stage of unknown size and aspect ratio, preserve visible click targets, prevent oversized or stretched compositions, and keep media plus hotspots aligned across any aspect ratio.
---

# WAF Style Guardrails

Use when working on `res/style.scss`, `res/layout.html`, or behavior code that depends on the size/shape of visible UI. Goal: make the activity fit and behave inside the pipeline's stage — whatever size and aspect ratio it is — not build a generic responsive webpage.

## Assumptions

- WAF HTML modules, `mainOnly` layout unless the files say otherwise.
- The parent-provided stage size and aspect ratio are not guaranteed (may be wider or narrower than the media); never hard-code a single stage size.
- A bottom nav bar exists in the player; the activity must fully fit the visible stage without scrolling.

## Non-Negotiable Rules

1. The module root fills the available activity area.
2. All intended click targets are visible on first render, without scrolling, zooming, or hidden overflow.
3. The main interaction surface stays fully visible after the intro starts.
4. The activity stays readable and clickable at any stage size and aspect ratio.

## Layout & Sizing

- Root: `width/height: 100%`; use `min-width/min-height: 0` so flex/grid children shrink; `overflow: hidden` only as a safeguard, not to hide oversized content. Don't rely on `max-width`/`max-height` to size the root.
- Prefer relative units (`%`, `cqw`/`cqh`, `minmax(0, 1fr)`) so layout adapts to the actual stage. Use small `px` only where a fixed value is genuinely required; avoid large `rem`-driven layouts (WAF scales root font size from stage height).
- Give the main interactive region (grid, board, tray, choices) most of the height; keep headers, instructions, and decoration compact. Reduce decorative chrome first when space is tight.

## Do Not

- Assume desktop proportions, or center a giant card / oversized headings / tall banners that consume the stage.
- Let typography dominate vertical space or hide clickables below the fold.
- Clip interactive content behind decorative overlays, or stretch a background so the interaction area looks distorted.

## Media + Hotspot Alignment (Stage / Media-Plane)

When click targets overlay a background image/video and must line up with it, never position them against the stage. The stage aspect ratio may not match the media (usually 16:9). Decouple the viewport from the media coordinate system:

- `.stage` — the cropped viewport; don't control its size. `position: absolute; inset: 0; overflow: hidden; container-type: size;`
- `.media-plane` — a fixed 16:9 system that covers and centers in the stage. Put the media **and** all hotspots inside it.

```css
.media-plane {
  position: absolute; left: 50%; top: 50%;
  width:  max(100cqw, calc(100cqh * 16 / 9));
  height: max(100cqh, calc(100cqw * 9 / 16));
  transform: translate(-50%, -50%);
  container-type: size;
}
.media { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.hotspot {                                   /* --x/--y = center */
  position: absolute; left: var(--x); top: var(--y);
  width: var(--w); height: var(--h);
  transform: translate(-50%, -50%);
}
```

For a generated full-stage video layer, never rely on the video's intrinsic dimensions.
The layer must fill the activity, and its direct video child must use `display: block`,
`width: 100%`, `height: 100%`, and an intentional `object-fit` (normally `cover`).
When hotspots align to the video, put both inside the same `.media-plane`.

- Media and hotspots are children of `.media-plane`, never `.stage`.
- Store coordinates as percentages of the 16:9 media (from 1280x720: `x = mediaX/1280*100%`, `y = mediaY/720*100%`). Author them in CSS classes (`.hotspot--1 { --x: 42%; --y: 45%; }`) and apply with `classList.add(...)`.
- To convert legacy stage-pixel coords, map onto the covering plane first: `planeW = max(stageW, stageH*16/9)`, `offsetX = (planeW-stageW)/2`, then `xPct = (pixelX+offsetX)/planeW*100`.
- Keep must-tap hotspots toward the center: `cover` crops the plane edges on non-16:9 stages, so edge targets can disappear. `cqh`/`cqw` units scale text/icons with the media.

## Behavior Coordination

Keep scene containers stable between states; don't introduce layout jumps that move click targets. Use visual-state classes for highlight/selected/guided focus, and preserve hit-target clarity after wrong-answer, hint, or success transitions.

## Final Self-Check

- Root fills the area; nothing overflows or scrolls at any stage size.
- Main interaction surface and all click targets are visible on first render.
- Headers/instructions don't crowd the interaction region; nothing looks stretched or cropped.
- Decorative layers don't block input.
- Hotspots stay aligned with their media and inside the visible safe area when the stage crops the media.

If any fail, simplify and compact before returning.
