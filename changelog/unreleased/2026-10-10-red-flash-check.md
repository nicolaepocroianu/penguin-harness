# Scene videos are checked for red flashing

- **Date:** 2026-10-10
- **Type:** feat
- **Scope:** `activities`

The flash check now also applies WCAG 2.3.1's red flash threshold, measured on each frame's average
colour. A red flash is a change of more than 20 in (R − G − B) × 320 from or to a saturated red,
meaning red is at least 80% of R + G + B. General flashes are now measured by true relative
luminance worked out from that colour rather than by brightness alone. A saturated red and a grey
just as bright no longer pass as the same picture.
